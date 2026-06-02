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
 * Pick the right Setup.exe out of a release's assets list.
 *
 * pattern can include "{version}" — we substitute the tag (sans leading 'v')
 * before matching. Returns the matched asset object (with .browser_download_url
 * and .size and .name) or null.
 */
function pickAsset(assets, pattern, tagName) {
  if (!Array.isArray(assets) || assets.length === 0) return null;
  const version = String(tagName || '').replace(/^v/i, '');
  const expected = pattern.replace(/\{version\}/g, version).toLowerCase();
  // Exact-name match first
  const exact = assets.find((a) => (a.name || '').toLowerCase() === expected);
  if (exact) return exact;
  // Fall back: any .exe that looks like a Veloxa Setup
  return assets.find((a) => /veloxa.*setup.*\.exe$/i.test(a.name || '')) || null;
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
  assetPattern = 'VeloxaWatermarkStudio-Setup-{version}.exe',
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
  const now = Date.now();

  // Daily debounce: if we have a cached result and it's fresh, return it.
  if (!force && settingsAdapter && cached && lastCheck && (now - lastCheck) < debounceMs) {
    const has = compareVersions(currentVersion, cached.latest) < 0;
    return {
      hasUpdate: has,
      current: currentVersion,
      latest: cached.latest,
      asset: cached.asset,
      releaseUrl: cached.releaseUrl,
      body: cached.body,
      dismissed: dismissed === cached.latest,
      cached: true,
    };
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

  const asset = pickAsset(release.assets || [], assetPattern, tagName);
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

  return {
    hasUpdate,
    current: currentVersion,
    latest,
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null,
    releaseUrl,
    body,
    dismissed: dismissed === latest,
    cached: false,
  };
}

/**
 * Download an asset (the Setup .exe) to destPath with optional progress
 * callback. Returns destPath on success, throws on error.
 *
 * Streams to a `.partial` file and renames on completion so an interrupted
 * download doesn't leave behind a half-baked .exe the user might run.
 */
function downloadAsset(url, destPath, { onProgress, timeoutMs = 60000, expectedSize = null } = {}) {
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
        const out = fs.createWriteStream(partial);
        res.on('data', (chunk) => {
          received += chunk.length;
          if (onProgress) onProgress({ received, total, percent: total ? received / total : 0 });
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
  // exposed for tests
  _fetch,
};
