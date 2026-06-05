/**
 * Auto-updater core — GitHub Releases backend.
 *
 * Pure Node, no Electron deps, so it's testable from CLI and the HTTP server
 * can expose `/api/update/check` too. The Electron main process wires this
 * to IPC + UI banner; on success the user clicks "Download" → we stream the
 * Setup .exe to %USERPROFILE%/Downloads and shell-open it for install.
 *
 * Why GitHub Releases (and not electron-updater):
 *  - We ship via Inno Setup, not NSIS — electron-updater's auto-update flow
 *    is built for NSIS. Inno needs a manual installer launch.
 *  - GitHub's API is free, public, no extra infrastructure required.
 *  - Users keep full control over WHEN to install (we never silently replace
 *    a running binary).
 *
 * Daily-debounce: a successful check stamps settings.lastUpdateCheckMs.
 * Subsequent checks within 24h short-circuit and return the previously-found
 * `latest` info (kept in settings.cachedLatestRelease) without hitting GitHub.
 * Force a fresh check by passing `{ force: true }`.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_DEBOUNCE_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024; // 4 MB cap on the JSON release payload

/**
 * Compare two semver-ish version strings.
 *
 * Returns:
 *   -1 if a < b
 *    0 if a == b
 *    1 if a > b
 *
 * Strips any leading 'v' (so "v2.5.0" == "2.5.0"). Compares numeric segments
 * left-to-right; missing segments are treated as 0 ("2.5" == "2.5.0"). A
 * pre-release suffix (e.g. "2.5.0-beta.1") is ordered BEFORE the same
 * version without a suffix ("2.5.0-beta.1" < "2.5.0"), per semver §11.
 */
function compareVersions(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  const parse = (s) => {
    const clean = String(s).trim().replace(/^v/i, '');
    const [main, pre] = clean.split('-', 2);
    const nums = main.split('.').map((n) => parseInt(n, 10));
    return { nums, pre };
  };
  const A = parse(a);
  const B = parse(b);
  const maxLen = Math.max(A.nums.length, B.nums.length);
  for (let i = 0; i < maxLen; i += 1) {
    const x = Number.isFinite(A.nums[i]) ? A.nums[i] : 0;
    const y = Number.isFinite(B.nums[i]) ? B.nums[i] : 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  // Numeric parts equal — handle pre-release ordering.
  if (A.pre && !B.pre) return -1;
  if (!A.pre && B.pre) return 1;
  if (A.pre && B.pre) {
    if (A.pre < B.pre) return -1;
    if (A.pre > B.pre) return 1;
  }
  return 0;
}

/**
 * Pick the right installer asset out of a release's assets list.
 *
 * Pattern matching is platform-aware so Windows users never get offered the
 * macOS .zip and vice versa. Three calling conventions:
 *
 *   pickAsset(assets, pattern, tagName)
 *       Legacy single-string form. The pattern is matched literally (with
 *       `{version}` substituted) and the cross-platform safe fallback is
 *       skipped — used by callers that already know which artifact they want.
 *
 *   pickAsset(assets, { patterns: {...}, platform, arch }, tagName)
 *       Platform-aware form. `patterns` is keyed by `${platform}-${arch}`
 *       (e.g. `win32-x64`, `darwin-arm64`, `darwin-x64`). Pulls the right
 *       pattern for the calling machine, falls back to a same-platform regex
 *       if the exact name doesn't match. Never falls across platforms — a
 *       Mac user with a stale exe in the release will get `null`, not a .exe
 *       they can't run.
 */
function pickAsset(assets, patternOrCfg, tagName) {
  if (!Array.isArray(assets) || assets.length === 0) return null;
  const version = String(tagName || '').replace(/^v/i, '');

  // Resolve to { pattern, platform } for this call.
  let pattern, platform;
  if (typeof patternOrCfg === 'string') {
    pattern = patternOrCfg;
    platform = null;            // legacy: no platform-aware fallback
  } else if (patternOrCfg && typeof patternOrCfg === 'object') {
    platform = patternOrCfg.platform || process.platform;
    const arch = patternOrCfg.arch || process.arch;
    const patterns = patternOrCfg.patterns || {};
    pattern = patterns[`${platform}-${arch}`]
           || patterns[platform]
           || null;
    if (!pattern) return null;
  } else {
    return null;
  }

  const expected = pattern.replace(/\{version\}/g, version).toLowerCase();
  const exact = assets.find((a) => (a.name || '').toLowerCase() === expected);
  if (exact) return exact;

  // Same-platform regex fallback. We refuse to fall back across platforms —
  // returning a Win .exe to a Mac (or vice versa) would break the install
  // flow and confuse the user with a download they can't open.
  if (platform === 'darwin') {
    // The platform-aware caller supplies arch — only match the arch's zip,
    // never the other arch's. Use `patternOrCfg.arch` directly so a stale
    // global mock of process.arch doesn't slip through.
    const archForRegex = (typeof patternOrCfg === 'object' && patternOrCfg.arch) || process.arch;
    const archPat = archForRegex === 'arm64' ? 'arm64' : 'x64';
    const re = new RegExp(`veloxa.*mac-${archPat}.*\\.zip$`, 'i');
    return assets.find((a) => re.test(a.name || '')) || null;
  }
  if (platform === 'win32' || platform == null) {
    return assets.find((a) => /veloxa.*setup.*\.exe$/i.test(a.name || '')) || null;
  }
  return null;
}

function fetchJson(urlStr, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return _fetch(urlStr, { headers, timeoutMs, expectJson: true });
}

// Internal: GET with redirect handling, timeout, size cap, and optional JSON parse.
function _fetch(urlStr, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, expectJson = false, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { reject(new Error('Invalid URL: ' + urlStr)); return; }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({
      method: 'GET',
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: {
        // GitHub requires a User-Agent; without one, the API returns 403.
        'User-Agent': 'Veloxa-Watermark-Studio-Updater',
        Accept: 'application/vnd.github+json',
        ...headers,
      },
    }, (res) => {
      // Redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error('Too many redirects'));
          return;
        }
        const next = new URL(res.headers.location, u).toString();
        _fetch(next, { headers, timeoutMs, expectJson, redirects: redirects + 1 }).then(resolve, reject);
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > MAX_RESPONSE_BYTES) {
          res.destroy(new Error('Response too large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode === 304) {
          resolve({ status: 304, body: null, headers: res.headers });
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}: ${body.toString('utf8').slice(0, 200)}`);
          err.status = res.statusCode;
          err.headers = res.headers;
          reject(err);
          return;
        }
        if (expectJson) {
          try { resolve({ status: res.statusCode, body: JSON.parse(body.toString('utf8')), headers: res.headers }); }
          catch (e) { reject(new Error('Invalid JSON response')); }
        } else {
          resolve({ status: res.statusCode, body, headers: res.headers });
        }
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Check GitHub Releases for a newer version.
 *
 * Args:
 *   currentVersion — required, e.g. "2.4.2"
 *   repo           — required, "owner/name"
 *   assetPattern   — optional, default uses package.json veloxa.updateAssetPattern
 *   force          — optional, bypass the daily debounce
 *   settingsAdapter — optional, { get(), set(patch) } to enable daily debounce
 *                    and dismissedUpdateVersion suppression. Pass `null` for
 *                    a one-shot check (tests, CLI).
 *
 * Returns:
 *   { hasUpdate: bool, current, latest, asset, releaseUrl, body, dismissed, cached }
 *   Throws on network errors so the caller can show a "couldn't reach GitHub" toast.
 */
async function check({
  currentVersion,
  repo,
  // Legacy single-string pattern — kept for back-compat. If both are passed,
  // assetPatterns wins.
  assetPattern = 'VeloxaWatermarkStudio-Setup-{version}.exe',
  // Platform-aware map: { 'win32-x64': '...', 'darwin-arm64': '...', 'darwin-x64': '...' }
  // When present, pickAsset selects by `${process.platform}-${process.arch}`.
  assetPatterns = null,
  // For tests: override the platform/arch the picker uses (defaults to process.*).
  platform = process.platform,
  arch = process.arch,
  force = false,
  settingsAdapter = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  debounceMs = DEFAULT_DEBOUNCE_MS,
} = {}) {
  if (!currentVersion) throw new Error('currentVersion is required');
  if (!repo) throw new Error('repo is required (e.g. "owner/name")');

  const cfg = settingsAdapter ? settingsAdapter.get() : {};
  const dismissed = cfg.dismissedUpdateVersion || null;
  const lastCheck = cfg.lastUpdateCheckMs || 0;
  const cached = cfg.cachedLatestRelease || null;
  const snoozeUntilMs = cfg.snoozeBannerUntilMs || 0;
  const snoozedVersion = cfg.snoozeBannerVersion || null;
  const now = Date.now();

  // ---- Self-healing cache: clear when we've caught up ----
  // If the cached `latest` is no longer ahead of currentVersion, the cache is
  // stale — typically because the user just installed the version we had
  // queued. Clearing here means:
  //   1. Settings panel's "Latest known" tile no longer pins to the old value.
  //   2. The next check goes to the network instead of returning a no-op cached
  //      result that says "you're up to date" with a stale asset URL.
  // Without this, the cache could pin to "v2.7.4 latest" forever after install,
  // surfacing the OLD asset URL in any UI that reads cachedLatestRelease
  // directly (Settings panel does).
  if (settingsAdapter && cached && cached.latest &&
      compareVersions(currentVersion, cached.latest) >= 0) {
    settingsAdapter.set({
      cachedLatestRelease: null,
      lastUpdateCheckMs: 0,
    });
  }

  // ---- Banner snooze: "Later" persists for 24h per version ----
  // The X (Later) button on the banner used to just set in-memory status to
  // 'idle' — next launch's silent check would re-show the banner for the
  // exact same version, which feels like nagging. Now Later persists a
  // `snoozeBannerUntilMs` + `snoozeBannerVersion` pair: if the same version
  // is still the latest within the snooze window, we suppress.
  function applySnooze(result) {
    if (snoozeUntilMs && now < snoozeUntilMs && result.latest === snoozedVersion) {
      return { ...result, hasUpdate: false, snoozed: true };
    }
    return { ...result, snoozed: false };
  }

  // Daily debounce: if we have a fresh cached result, return it (re-reading
  // settings *after* the self-heal above so cached can be null now).
  const cachedAfterHeal = settingsAdapter ? (settingsAdapter.get().cachedLatestRelease || null) : cached;
  const lastCheckAfterHeal = settingsAdapter ? (settingsAdapter.get().lastUpdateCheckMs || 0) : lastCheck;
  if (!force && settingsAdapter && cachedAfterHeal && lastCheckAfterHeal && (now - lastCheckAfterHeal) < debounceMs) {
    const has = compareVersions(currentVersion, cachedAfterHeal.latest) < 0;
    return applySnooze({
      hasUpdate: has,
      current: currentVersion,
      latest: cachedAfterHeal.latest,
      asset: cachedAfterHeal.asset,
      releaseUrl: cachedAfterHeal.releaseUrl,
      body: cachedAfterHeal.body,
      dismissed: dismissed === cachedAfterHeal.latest,
      cached: true,
    });
  }

  const url = `https://api.github.com/repos/${repo}/releases/latest`;
  let res;
  try {
    res = await fetchJson(url, { timeoutMs });
  } catch (err) {
    if (err.status === 404) {
      // Repo has no releases yet — not really an error.
      return { hasUpdate: false, current: currentVersion, latest: null, asset: null, releaseUrl: null, body: null, dismissed: false, cached: false, reason: 'no-releases' };
    }
    if (err.status === 403) {
      // Rate-limited — bubble up so caller can show a helpful message.
      const e = new Error('GitHub API rate limit exceeded — try again later');
      e.status = 403; e.cause = err;
      throw e;
    }
    throw err;
  }

  const release = res.body || {};
  const tagName = release.tag_name || release.name || '';
  const latest = String(tagName).replace(/^v/i, '');
  if (!latest) {
    return { hasUpdate: false, current: currentVersion, latest: null, asset: null, releaseUrl: null, body: null, dismissed: false, cached: false, reason: 'no-tag' };
  }

  // Use the platform-aware picker when patterns are provided; otherwise
  // fall back to the legacy single-pattern lookup.
  const asset = assetPatterns
    ? pickAsset(release.assets || [], { patterns: assetPatterns, platform, arch }, tagName)
    : pickAsset(release.assets || [], assetPattern, tagName);
  const releaseUrl = release.html_url || `https://github.com/${repo}/releases/tag/${tagName}`;
  const body = release.body || '';
  const cmp = compareVersions(currentVersion, latest);
  const hasUpdate = cmp < 0;

  // Persist for daily-debounce
  if (settingsAdapter) {
    settingsAdapter.set({
      lastUpdateCheckMs: now,
      cachedLatestRelease: {
        latest,
        asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
        releaseUrl,
        body,
      },
    });
  }

  return applySnooze({
    hasUpdate,
    current: currentVersion,
    latest,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
    releaseUrl,
    body,
    dismissed: dismissed === latest,
    cached: false,
  });
}

/**
 * Reconcile stored state against the actual running version. Called once at
 * app launch BEFORE any update check runs.
 *
 * The settings file persists across installs (it lives in %APPDATA%, not the
 * install dir), which is mostly what you want — profiles, settings, queue
 * survive. But three stale fields cause the "why am I being asked to install
 * again?" pattern:
 *
 *   1. cachedLatestRelease.latest = the version we just installed → the cache
 *      reports "you're up to date" with the OLD asset URL (so any UI reading
 *      this directly, like Settings panel's "Latest known" tile, shows
 *      misleading info).
 *   2. dismissedUpdateVersion = older than currentVersion → the skip flag is
 *      meaningless now; clearing it lets newly-published versions notify.
 *   3. snoozeBannerVersion = older than currentVersion → snooze should clear.
 *
 * Detection signal: settings.lastSeenAppVersion (persisted here) differs from
 * app.getVersion(). If yes, a version change happened since last launch (could
 * be install OR downgrade). Reset the stale fields.
 *
 * Idempotent: running on every launch is fine. The clear-paths only fire when
 * actual mismatches exist.
 */
function reconcilePostInstall(currentVersion, settingsAdapter) {
  if (!settingsAdapter || !currentVersion) return { changed: false };
  const cfg = settingsAdapter.get();
  const lastSeen = cfg.lastSeenAppVersion || null;
  const patch = {};
  let changed = false;

  // First-run / version-change detected.
  if (lastSeen !== currentVersion) {
    patch.lastSeenAppVersion = currentVersion;
    changed = true;

    // Clear cache if its `latest` no longer leads currentVersion.
    if (cfg.cachedLatestRelease && cfg.cachedLatestRelease.latest &&
        compareVersions(currentVersion, cfg.cachedLatestRelease.latest) >= 0) {
      patch.cachedLatestRelease = null;
      patch.lastUpdateCheckMs = 0;
    }

    // Clear stale skip flag.
    if (cfg.dismissedUpdateVersion &&
        compareVersions(currentVersion, cfg.dismissedUpdateVersion) >= 0) {
      patch.dismissedUpdateVersion = null;
    }

    // Clear stale snooze.
    if (cfg.snoozeBannerVersion &&
        compareVersions(currentVersion, cfg.snoozeBannerVersion) >= 0) {
      patch.snoozeBannerVersion = null;
      patch.snoozeBannerUntilMs = 0;
    }
  }

  if (changed) settingsAdapter.set(patch);
  return { changed, patch };
}

/**
 * "Later" button persistence. Suppresses the banner for the given version
 * until `until` (defaults to 24h from now). Same version + same banner =
 * no nag for a day, but newly-found versions still surface immediately.
 */
function snoozeBanner(latestVersion, settingsAdapter, durationMs = 24 * 60 * 60 * 1000) {
  if (!settingsAdapter || !latestVersion) return;
  settingsAdapter.set({
    snoozeBannerVersion: latestVersion,
    snoozeBannerUntilMs: Date.now() + durationMs,
  });
}

/**
 * Download an asset (the Setup .exe) to destPath with optional progress.
 *
 * Progress callback receives { received, total, percent, bytesPerSec }
 * (bytesPerSec added in v2.6.4 so the UI can show download speed + ETA).
 *
 * Default path is a single HTTPS stream — that turns out to be FASTER on
 * common networks than ranged-parallel against the Azure Blob backend GitHub
 * Releases uses. Benchmarking against the real CDN on a 100 Mbps line:
 *
 *   single-stream (1):  6.6 s @ 12.4 MB/s
 *   parallel (6 chunks): 96.6 s @ 0.85 MB/s  ← Azure per-IP throttles +
 *                                              TLS-handshake overhead per
 *                                              chunk dominates.
 *
 * So parallel ranged download is OPT-IN via `parallelChunks > 1`. The path
 * remains available for users on networks where single-stream is throttled
 * lower than aggregate parallel could achieve. Auto-falls-back to single
 * stream if the server returns 200 instead of 206 for a Range request.
 */
async function downloadAsset(url, destPath, opts = {}) {
  const {
    onProgress, timeoutMs = 120000, expectedSize = null,
    parallelChunks = 1, maxRetries = 2,
  } = opts;

  if (parallelChunks > 1 && expectedSize && expectedSize > 4 * 1024 * 1024) {
    try {
      return await downloadParallelRanged(url, destPath, {
        onProgress, timeoutMs, expectedSize, parallelChunks, maxRetries,
      });
    } catch (err) {
      if (process.env.VELOXA_DEBUG_UPDATER) {
        console.warn('Parallel download fell back to single-stream:', err.message);
      }
    }
  }
  return downloadSingleStream(url, destPath, { onProgress, timeoutMs, expectedSize });
}

/**
 * Parallel ranged download. Pre-sizes the .partial file, splits into N
 * byte-ranges, fires N concurrent HTTPS GETs with `Range: bytes=A-B`, each
 * writing to its own offset. Retries individual chunks on transient
 * failures, aborts all peers when any chunk fails terminally.
 */
function downloadParallelRanged(url, destPath, opts) {
  return new Promise(async (resolve, reject) => {
    const { onProgress, timeoutMs, expectedSize, parallelChunks, maxRetries } = opts;
    const partial = destPath + '.partial';

    let settled = false;
    const inflightReqs = new Set();
    function fail(err) {
      if (settled) return;
      settled = true;
      for (const r of inflightReqs) try { r.destroy(); } catch {}
      fs.unlink(partial, () => reject(err instanceof Error ? err : new Error(String(err))));
    }
    function succeed(p) {
      if (settled) return;
      settled = true;
      resolve(p);
    }

    try {
      // 1. Pre-allocate the .partial file at the final size so we can write
      // chunks at arbitrary offsets without races.
      const fd = await fsp.open(partial, 'w');
      await fd.truncate(expectedSize);
      await fd.close();

      // 2. Compute byte ranges. Slight rounding leaves the last chunk
      // covering the trailing bytes, which is fine.
      const chunkSize = Math.ceil(expectedSize / parallelChunks);
      const chunks = [];
      for (let i = 0; i < parallelChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, expectedSize - 1);
        if (start <= end) chunks.push({ index: i, start, end });
      }

      // 3. Throttled progress aggregator — N chunks emitting on every TCP
      // packet would flood IPC. Cap at ~20 emits/sec; always emit on done.
      const chunkBytes = new Array(chunks.length).fill(0);
      const startTime = Date.now();
      let lastEmitMs = 0;
      function emitProgress(force) {
        const now = Date.now();
        if (!force && now - lastEmitMs < 50) return;
        lastEmitMs = now;
        const received = chunkBytes.reduce((a, b) => a + b, 0);
        const elapsed = (now - startTime) / 1000;
        if (onProgress) onProgress({
          received,
          total: expectedSize,
          percent: received / expectedSize,
          bytesPerSec: elapsed > 0 ? Math.round(received / elapsed) : 0,
        });
      }

      // 4. Download each chunk with bounded retry.
      await Promise.all(chunks.map(async (chunk) => {
        let lastErr;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (settled) return;
          try {
            await downloadOneRange(url, partial, chunk.start, chunk.end, (bytes) => {
              chunkBytes[chunk.index] = bytes;
              emitProgress();
            }, timeoutMs, inflightReqs);
            return;
          } catch (err) {
            lastErr = err;
            chunkBytes[chunk.index] = 0;
            if (attempt < maxRetries) {
              await new Promise((r) => setTimeout(r, 250 * Math.pow(2, attempt)));
            }
          }
        }
        throw lastErr || new Error(`Chunk ${chunk.index} failed after ${maxRetries + 1} attempts`);
      }));

      // 5. Final progress event + size verification + atomic rename
      emitProgress(true);
      const stat = await fsp.stat(partial);
      if (stat.size !== expectedSize) {
        fail(new Error(`Size mismatch after parallel download: ${stat.size} vs ${expectedSize}`));
        return;
      }
      await fsp.rename(partial, destPath);
      succeed(destPath);
    } catch (err) {
      fail(err);
    }
  });
}

// Issue a single ranged GET and write its body to the right offset in the
// pre-allocated .partial file. Handles redirects (GitHub → Azure Blob).
function downloadOneRange(url, partialPath, start, end, onBytes, timeoutMs, inflightReqs) {
  return new Promise((resolve, reject) => {
    const fetchWithRedirects = (currentUrl, redirects = 0) => {
      const cu = new URL(currentUrl);
      const mod = cu.protocol === 'http:' ? http : https;
      const req = mod.request({
        method: 'GET',
        protocol: cu.protocol,
        hostname: cu.hostname,
        port: cu.port || (cu.protocol === 'https:' ? 443 : 80),
        path: cu.pathname + (cu.search || ''),
        headers: {
          'User-Agent': 'Veloxa-Watermark-Studio-Updater',
          Accept: 'application/octet-stream',
          Range: `bytes=${start}-${end}`,
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) { reject(new Error('Too many redirects')); return; }
          fetchWithRedirects(new URL(res.headers.location, cu).toString(), redirects + 1);
          return;
        }
        // 200 means the server ignored our Range header and is sending the
        // full file. Writing that at offset `start` would corrupt everything
        // after it; bail and let the parallel path fall back to single-stream.
        if (res.statusCode === 200) {
          reject(new Error('Server does not support Range requests'));
          res.resume();
          return;
        }
        if (res.statusCode !== 206) {
          reject(new Error(`Range request failed: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const ws = fs.createWriteStream(partialPath, { flags: 'r+', start });
        let received = 0;
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onBytes) onBytes(received);
        });
        res.pipe(ws);
        ws.on('finish', () => ws.close(() => { inflightReqs.delete(req); resolve(); }));
        ws.on('error', (e) => { inflightReqs.delete(req); reject(e); });
        res.on('error', (e) => { inflightReqs.delete(req); reject(e); });
        res.on('aborted', () => { inflightReqs.delete(req); reject(new Error(`Chunk aborted at ${received} bytes`)); });
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('Chunk timeout')));
      req.on('error', (e) => { inflightReqs.delete(req); reject(e); });
      inflightReqs.add(req);
      req.end();
    };
    fetchWithRedirects(url);
  });
}

// Legacy single-stream download — kept as fallback when Range isn't honored
// or when the caller passes parallelChunks <= 1 or doesn't know the size.
function downloadSingleStream(url, destPath, { onProgress, timeoutMs = 60000, expectedSize = null } = {}) {
  return new Promise((resolve, reject) => {
    const partial = destPath + '.partial';
    let u;
    try { u = new URL(url); } catch (e) { reject(new Error('Invalid URL')); return; }

    // Centralized failure path — wraps reject so we always clean up the
    // .partial file before the promise settles. Prevents half-baked .exe
    // from being left around when a download is interrupted (network drop,
    // server truncates Content-Length, abort, etc.).
    let settled = false;
    function fail(err) {
      if (settled) return;
      settled = true;
      fs.unlink(partial, () => reject(err instanceof Error ? err : new Error(String(err))));
    }
    function succeed(p) {
      if (settled) return;
      settled = true;
      resolve(p);
    }

    // Follow redirects manually because GitHub serves assets via a 302 to S3.
    const fetchWithRedirects = (currentUrl, redirects = 0) => {
      const cu = new URL(currentUrl);
      const mod = cu.protocol === 'http:' ? http : https;
      const req = mod.request({
        method: 'GET',
        protocol: cu.protocol,
        hostname: cu.hostname,
        port: cu.port || (cu.protocol === 'https:' ? 443 : 80),
        path: cu.pathname + (cu.search || ''),
        headers: {
          'User-Agent': 'Veloxa-Watermark-Studio-Updater',
          // For asset download we want octet-stream, not the API's JSON.
          Accept: 'application/octet-stream',
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) {
            fail(new Error('Too many redirects'));
            return;
          }
          fetchWithRedirects(new URL(res.headers.location, cu).toString(), redirects + 1);
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          fail(new Error(`Download failed: HTTP ${res.statusCode}`));
          res.resume();
          return;
        }
        const total = parseInt(res.headers['content-length'], 10) || expectedSize || 0;
        let received = 0;
        const startTime = Date.now();
        const out = fs.createWriteStream(partial);
        res.on('data', (chunk) => {
          received += chunk.length;
          const elapsed = (Date.now() - startTime) / 1000;
          if (onProgress) onProgress({
            received, total,
            percent: total ? received / total : 0,
            bytesPerSec: elapsed > 0 ? Math.round(received / elapsed) : 0,
          });
        });
        res.pipe(out);
        out.on('finish', () => {
          out.close((err) => {
            if (err) { fail(err); return; }
            // Size check — verifies what's on disk matches what we expected.
            // GitHub asset_size is authoritative when provided.
            if (expectedSize && Math.abs(received - expectedSize) > 0) {
              fail(new Error(`Download incomplete: got ${received} bytes, expected ${expectedSize}`));
              return;
            }
            fs.rename(partial, destPath, (rErr) => {
              if (rErr) { fail(rErr); return; }
              succeed(destPath);
            });
          });
        });
        out.on('error', fail);
        // Response stream errors include 'aborted' (server closed before
        // Content-Length bytes were sent). All paths funnel through fail()
        // so the .partial gets cleaned up no matter what.
        res.on('error', fail);
        res.on('aborted', () => fail(new Error(`Download aborted: connection closed after ${received} bytes`)));
      });
      req.setTimeout(timeoutMs, () => req.destroy(new Error('Download timeout')));
      req.on('error', fail);
      req.end();
    };
    fetchWithRedirects(u.toString());
  });
}

module.exports = {
  check,
  downloadAsset,
  compareVersions,
  pickAsset,
  reconcilePostInstall,
  snoozeBanner,
  // exposed for tests
  _fetch,
};
