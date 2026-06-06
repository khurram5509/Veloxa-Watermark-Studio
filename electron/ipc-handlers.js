const { ipcMain, dialog, app, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const profiles = require('../engine/profiles');
const settings = require('../engine/settings');
const logger = require('../engine/logger');
const queue = require('../engine/queue');
const { scanPaths } = require('../engine/scanner');
const { validateProfile } = require('../engine/validation');
const { logosDir } = require('../engine/paths');
const converter = require('../engine/converter');
const updater = require('../engine/updater');
const pkg = require('../package.json');

let mainWindowGetter = () => null;

function send(channel, payload) {
  const w = mainWindowGetter();
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function registerIpcHandlers({ getMainWindow }) {
  mainWindowGetter = getMainWindow;

  // wire engine events -> renderer
  queue.events.on('updated', (state) => send('queue:updated', state));
  queue.events.on('progress', (data) => send('queue:progress', data));
  queue.events.on('done', (summary) => send('queue:done', summary));
  logger.events.on('line', (line) => send('log:line', line));

  // ---- Dialogs ----
  ipcMain.handle('dialog:pickFiles', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Select documents',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'pptx'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Select folder',
      properties: ['openDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:pickImage', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Select logo image',
      properties: ['openFile'],
      // Limited to PNG/JPG — the only formats reliably supported across PDF (pdf-lib),
      // DOCX (Word VML imagedata), and PPTX (DrawingML blip).
      filters: [{ name: 'Images (PNG, JPG)', extensions: ['png', 'jpg', 'jpeg'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // ---- Scanning ----
  ipcMain.handle('scan:paths', async (_e, paths) => scanPaths(paths));

  // ---- Profiles ----
  ipcMain.handle('profiles:list', () => profiles.list());
  ipcMain.handle('profiles:save', (_e, p) => profiles.save(p));
  ipcMain.handle('profiles:delete', (_e, id) => profiles.remove(id));
  ipcMain.handle('profiles:duplicate', (_e, id) => profiles.duplicate(id));
  ipcMain.handle('profiles:setDefault', (_e, id) => profiles.setDefault(id));
  ipcMain.handle('profiles:export', async (_e, id, dest) => {
    const target = dest || (await dialog.showSaveDialog({
      title: 'Export profile',
      defaultPath: `veloxa-profile-${id}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })).filePath;
    if (!target) return null;
    return profiles.exportTo(id, target);
  });
  ipcMain.handle('profiles:import', async (_e, src) => {
    const source = src || (await dialog.showOpenDialog({
      title: 'Import profile',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })).filePaths[0];
    if (!source) return null;
    return profiles.importFrom(source);
  });

  // ---- Settings ----
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));

  // ---- Engine ----
  ipcMain.handle('engine:enqueue', async (_e, files, profileId) => {
    const profile = profiles.get(profileId) || profiles.getDefault();
    if (!profile) throw new Error('No profile available');
    return queue.enqueue(files, profile);
  });
  ipcMain.handle('engine:start', () => queue.start());
  ipcMain.handle('engine:pause', () => queue.pause());
  ipcMain.handle('engine:resume', () => queue.resume());
  ipcMain.handle('engine:cancel', () => queue.cancel());
  ipcMain.handle('engine:retryFailed', () => queue.retryFailed());
  ipcMain.handle('engine:clearCompleted', () => queue.clearCompleted());
  ipcMain.handle('engine:clearFailed', () => queue.clearFailed());
  ipcMain.handle('engine:clearDone', () => queue.clearDone());
  ipcMain.handle('engine:removeJob', (_e, jobId) => queue.removeJob(jobId));
  ipcMain.handle('engine:removeJobs', (_e, jobIds) => queue.removeJobs(jobIds));
  ipcMain.handle('engine:duplicateJobs', (_e, jobIds) => queue.duplicateJobs(jobIds));
  ipcMain.handle('engine:retryRows', (_e, jobIds) => queue.retryRows(jobIds));
  ipcMain.handle('engine:moveJobsTo', (_e, jobIds, where) => queue.moveJobsTo(jobIds, where));
  ipcMain.handle('engine:reorderJobs', (_e, orderedIds) => queue.reorderJobs(orderedIds));
  ipcMain.handle('engine:clearAll', () => queue.clearAll());

  // Destructive — deletes the source files from disk. The renderer is
  // responsible for the confirm-dialog UX; this handler just performs the
  // unlink. Failures (file locked, missing, permission denied) are
  // collected per-path so the UI can show "3 of 5 deleted, 2 errors".
  // We do NOT touch outputs here — the user's chosen "Delete 1 from Disk"
  // semantic is "remove the source only; the watermarked PDF stays."
  ipcMain.handle('engine:deleteSourceFiles', async (_e, paths) => {
    if (!Array.isArray(paths) || paths.length === 0) return { ok: true, deleted: [], errors: [] };
    const deleted = [];
    const errors = [];
    for (const p of paths) {
      try {
        await fsp.unlink(p);
        deleted.push(p);
        logger.info(`Deleted source file at user request: ${path.basename(p)}`);
      } catch (err) {
        errors.push({ path: p, error: err.message });
      }
    }
    return { ok: errors.length === 0, deleted, errors };
  });

  // Symmetric to deleteSourceFiles — removes the watermarked OUTPUT file
  // only, leaves source intact. Two separate menu items in v2.8.1 per the
  // user's chosen UX: "Delete source from disk" + "Delete output from
  // disk" each open their own confirm modal so it's never ambiguous which
  // file is going away.
  ipcMain.handle('engine:deleteOutputFiles', async (_e, paths) => {
    if (!Array.isArray(paths) || paths.length === 0) return { ok: true, deleted: [], errors: [] };
    const deleted = [];
    const errors = [];
    for (const p of paths) {
      try {
        await fsp.unlink(p);
        deleted.push(p);
        logger.info(`Deleted output file at user request: ${path.basename(p)}`);
      } catch (err) {
        errors.push({ path: p, error: err.message });
      }
    }
    return { ok: errors.length === 0, deleted, errors };
  });
  ipcMain.handle('engine:status', () => queue.status());

  // ---- Logs ----
  ipcMain.handle('logs:list', (_e, limit) => logger.list(limit));
  ipcMain.handle('logs:clear', () => logger.clear());

  // ---- Profile validation (Tier 1 #6) ----
  ipcMain.handle('engine:validateProfile', (_e, profile) => validateProfile(profile));

  // ---- Convert-to-PDF: report LibreOffice availability ----
  ipcMain.handle('app:checkConverter', async (_e, refresh) => converter.status(!!refresh));

  // ---- Logo library (Tier 1 #2) ----
  ipcMain.handle('app:listLogos', async () => {
    try {
      const dir = logosDir();
      const entries = await fsp.readdir(dir);
      const result = [];
      for (const f of entries) {
        if (!/\.(png|jpe?g)$/i.test(f)) continue;
        const full = path.join(dir, f);
        try {
          const stat = await fsp.stat(full);
          result.push({ path: full, filename: f, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {}
      }
      return result.sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      return [];
    }
  });
  ipcMain.handle('app:deleteLogo', async (_e, p) => {
    try {
      // Safety: only allow deletion within our managed logos dir
      const dir = logosDir();
      if (!p || !p.toLowerCase().startsWith(dir.toLowerCase())) {
        throw new Error('Refusing to delete file outside the logos folder');
      }
      await fsp.unlink(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---- Auto-updater (v2.5.0) ----
  // Settings adapter — gives the updater module read/write access to the
  // daily-debounce stamp + dismissed-version without leaking the whole
  // settings module into the engine's update layer.
  const updaterSettings = {
    get: () => settings.get(),
    set: (patch) => settings.set(patch),
  };
  const updateRepo = (pkg.veloxa && pkg.veloxa.updateRepo) || 'veloxa-app/watermark-studio';
  const assetPattern = (pkg.veloxa && pkg.veloxa.updateAssetPattern) || 'VeloxaWatermarkStudio-Setup-{version}.exe';
  // Platform-aware patterns — when present, pickAsset selects by
  // `${process.platform}-${process.arch}` so a Mac user never sees the
  // Windows .exe and a Windows user never sees the Mac .zip.
  const assetPatterns = (pkg.veloxa && pkg.veloxa.updateAssetPatterns) || null;

  // ---- Post-install reconciliation (v2.7.5) ----
  // Settings (cachedLatestRelease / dismissedUpdateVersion / snooze) persist
  // across installs because they live in %APPDATA%, separate from the install
  // dir. After a successful install, three things become stale:
  //   • cachedLatestRelease.latest = the version we just installed → would
  //     surface old asset URLs in the Settings panel "Latest known" tile
  //   • dismissedUpdateVersion = older than current → blocking notifications
  //     for a version the user has already moved past
  //   • snoozeBannerVersion / snoozeBannerUntilMs = stale snooze for an older
  //     prompt
  // reconcilePostInstall detects a version change by comparing the running
  // app.getVersion() to settings.lastSeenAppVersion (persisted by this call),
  // and clears the stale fields. Idempotent — running on every launch is fine.
  try {
    const reconciled = updater.reconcilePostInstall(app.getVersion(), updaterSettings);
    if (reconciled && reconciled.changed) {
      logger.info(`Post-install reconcile: running ${app.getVersion()}, cleared stale updater state.`);
    }
  } catch (err) {
    logger.warn(`reconcilePostInstall failed (non-fatal): ${err.message}`);
  }

  ipcMain.handle('updater:check', async (_e, opts = {}) => {
    try {
      const result = await updater.check({
        currentVersion: app.getVersion(),
        repo: updateRepo,
        // assetPatterns (map) wins; assetPattern (string) is the back-compat fallback.
        assetPatterns,
        assetPattern,
        force: !!opts.force,
        settingsAdapter: updaterSettings,
      });
      return { ok: true, platform: process.platform, arch: process.arch, ...result };
    } catch (err) {
      logger.warn(`Update check failed: ${err.message}`);
      return { ok: false, error: err.message, current: app.getVersion() };
    }
  });

  ipcMain.handle('updater:download', async (_e, { url, name, size } = {}) => {
    if (!url) return { ok: false, error: 'No download URL' };
    try {
      const downloadsDir = app.getPath('downloads') || app.getPath('temp');
      // Default filename mirrors the asset extension when name isn't supplied
      // (only really happens in older renderer code paths). Win → .exe, Mac → .zip.
      const platformDefaultName = process.platform === 'darwin'
        ? `VeloxaWatermarkStudio-mac-${process.arch}.zip`
        : 'VeloxaWatermarkStudio-Setup.exe';
      const safeName = (name || platformDefaultName).replace(/[\\/:*?"<>|]+/g, '_');
      const dest = path.join(downloadsDir, safeName);

      // Stream the file with progress events to the renderer.
      const w = mainWindowGetter();
      const onProgress = (p) => {
        if (w && !w.isDestroyed()) w.webContents.send('updater:progress', p);
      };
      const finalPath = await updater.downloadAsset(url, dest, {
        onProgress,
        expectedSize: size || null,
      });
      logger.info(`Downloaded update installer to ${finalPath}`);
      return { ok: true, path: finalPath };
    } catch (err) {
      logger.error(`Update download failed: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('updater:openInstaller', async (_e, installerPath, opts = {}) => {
    if (!installerPath || !fs.existsSync(installerPath)) {
      return { ok: false, error: 'Installer file not found' };
    }

    // ---- Platform / file-type mismatch guard ----
    // Refuse to launch an asset that obviously doesn't match the host. A Mac
    // user with a stale cached release from before the platform-aware updater
    // landed could end up with VeloxaWatermarkStudio-Setup-X.X.X.exe queued
    // — clicking Install would try to spawn a Windows PE binary via macOS
    // launchd, which fails noisily. Better: clear error, redirect to GitHub.
    const lower = installerPath.toLowerCase();
    if (process.platform === 'darwin' && lower.endsWith('.exe')) {
      logger.warn(`Refusing to launch Windows .exe on darwin: ${installerPath}`);
      return { ok: false, error: 'This download is the Windows installer (.exe). Re-check for updates to fetch the macOS .zip.', wrongPlatform: true };
    }
    if (process.platform === 'win32' && (lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.dmg'))) {
      logger.warn(`Refusing to launch macOS archive on win32: ${installerPath}`);
      return { ok: false, error: 'This download is the macOS bundle. Re-check for updates to fetch the Windows installer.', wrongPlatform: true };
    }

    // ---- macOS: hand the .zip to Archive Utility ----
    // The Mac asset is a .zip containing Veloxa Watermark Studio.app. There
    // is no auto-replace flow for unsigned drag-to-/Applications bundles, so
    // the right UX is: open the .zip (Archive Utility unpacks the .app next
    // to it), then highlight the resulting .app in Finder so the user can
    // drag it onto /Applications. com.apple.quarantine on the .zip propagates
    // to the extracted .app — we leave that alone; the user clears it via
    // right-click → Open → Open on first launch (one-time Gatekeeper bypass).
    if (process.platform === 'darwin' && /\.zip$/i.test(installerPath)) {
      try {
        const openErr = await shell.openPath(installerPath);
        if (openErr) return { ok: false, error: openErr };
        // Best-effort: highlight the (about-to-appear) .app once Archive Utility
        // finishes — Finder shows the .zip until extraction completes, after
        // which the .app appears alongside it.
        const appCandidate = path.join(path.dirname(installerPath), 'Veloxa Watermark Studio.app');
        setTimeout(() => {
          try {
            if (fs.existsSync(appCandidate)) shell.showItemInFolder(appCandidate);
            else shell.showItemInFolder(installerPath);
          } catch { /* non-fatal */ }
        }, 1500);
        return { ok: true, platform: 'darwin', kind: 'mac-zip', revealedAfterMs: 1500 };
      } catch (err) {
        logger.warn(`shell.openPath on mac zip failed: ${err.message}`);
        return { ok: false, error: err.message };
      }
    }

    // ---- Windows: SmartScreen MOTW strip + Inno /SILENT spawn ----
    // Windows attaches a "MOTW" (Mark-of-the-Web) zone-identifier stream to
    // files downloaded by HTTPS so SmartScreen knows to warn. The
    // (Save|Open)As… "Don't run" default has bitten users hard: they click
    // Install, see the warning, click Don't Run, and assume the update
    // happened. Strip the alternate data stream so the .exe runs without
    // SmartScreen blocking it. Best-effort — failure is non-fatal.
    try {
      const zoneStream = installerPath + ':Zone.Identifier';
      if (fs.existsSync(zoneStream)) fs.unlinkSync(zoneStream);
    } catch { /* ignore */ }

    // Spawn the Inno installer with /SILENT (shows a progress bar only,
    // no wizard) and CLOSE/RESTART so the running Veloxa app is shut down
    // before file replacement and relaunched once install completes.
    // Falls back to shell.openPath only if spawn itself fails.
    const { spawn } = require('node:child_process');
    try {
      const args = opts.veryVerbose
        ? [] // user explicitly wants the wizard (debug / "Show installer wizard" affordance)
        : [
            '/SILENT',
            '/SUPPRESSMSGBOXES',
            '/NORESTART',
            '/CLOSEAPPLICATIONS',
            '/RESTARTAPPLICATIONS',
          ];
      const child = spawn(installerPath, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      child.unref();
      // The installer will taskkill our exe partway through. Give it a
      // moment to actually attach before the renderer's main window is
      // torn down by the install.
      return { ok: true, platform: 'win32', kind: 'win-exe', silent: !opts.veryVerbose };
    } catch (err) {
      logger.warn(`Silent installer spawn failed (${err.message}), falling back to shell.openPath`);
      const result = await shell.openPath(installerPath);
      if (result) return { ok: false, error: result };
      return { ok: true, silent: false, fallback: 'shell.openPath' };
    }
  });

  // Reveal-in-File-Explorer fallback so the user can launch the installer
  // by hand if SmartScreen blocks the silent spawn.
  ipcMain.handle('updater:revealInstaller', async (_e, installerPath) => {
    if (!installerPath || !fs.existsSync(installerPath)) {
      return { ok: false, error: 'Installer file not found' };
    }
    shell.showItemInFolder(installerPath);
    return { ok: true };
  });

  ipcMain.handle('updater:dismissVersion', async (_e, version) => {
    if (!version) return { ok: false };
    settings.set({ dismissedUpdateVersion: String(version) });
    return { ok: true };
  });

  // "Later" button — snooze the banner for this exact version for 24 h.
  // Different from dismissVersion (permanent skip): a snooze re-surfaces the
  // banner tomorrow so it's not forgotten, but stops nagging today.
  ipcMain.handle('updater:snoozeBanner', async (_e, version) => {
    if (!version) return { ok: false };
    updater.snoozeBanner(String(version), updaterSettings);
    return { ok: true };
  });

  ipcMain.handle('updater:openReleaseUrl', async (_e, url) => {
    if (typeof url !== 'string' || !/^https:\/\/github\.com\//i.test(url)) {
      return { ok: false, error: 'Only github.com URLs allowed' };
    }
    shell.openExternal(url);
    return { ok: true };
  });

  // ---- v2.6.2 Settings polish: storage stats + data paths + reset/export/import ----
  ipcMain.handle('app:getStorageStats', async () => {
    const { dataDir, logosDir, profilesFile, settingsFile, logsFile } = require('../engine/paths');
    async function dirStats(p) {
      try {
        const entries = await fsp.readdir(p);
        let bytes = 0;
        for (const e of entries) {
          try { const s = await fsp.stat(path.join(p, e)); if (s.isFile()) bytes += s.size; } catch {}
        }
        return { count: entries.length, bytes };
      } catch { return { count: 0, bytes: 0 }; }
    }
    async function fileSize(p) {
      try { return (await fsp.stat(p)).size; } catch { return 0; }
    }
    const [logos, profilesBytes, settingsBytes, logsBytes] = await Promise.all([
      dirStats(logosDir()),
      fileSize(profilesFile()),
      fileSize(settingsFile()),
      fileSize(logsFile()),
    ]);
    return {
      logos,
      profiles: { bytes: profilesBytes, count: profiles.list().length },
      logs:     { bytes: logsBytes },
      settings: { bytes: settingsBytes },
    };
  });

  ipcMain.handle('app:getDataPaths', async () => {
    const { dataDir, logosDir, profilesFile, settingsFile, logsFile } = require('../engine/paths');
    return {
      dataDir: dataDir(),
      logosDir: logosDir(),
      profilesFile: profilesFile(),
      settingsFile: settingsFile(),
      logsFile: logsFile(),
    };
  });

  ipcMain.handle('app:resetSettings', async (_e, opts = {}) => {
    // opts.keep — optional array of keys to preserve (e.g. checkForUpdates so
    // a user who reset doesn't accidentally re-enable startup checks they'd
    // explicitly disabled). Defaults: keep nothing, full reset to DEFAULTS.
    try {
      const keep = Array.isArray(opts.keep) ? opts.keep : [];
      const current = settings.get();
      const { DEFAULTS } = require('../engine/settings');
      const preserved = {};
      for (const k of keep) if (k in current) preserved[k] = current[k];
      // settings.set spreads patch over the current cache; to do a true reset
      // we have to write the DEFAULTS shape directly. Use set() with the full
      // defaults object plus preserved overrides.
      const next = { ...DEFAULTS, ...preserved };
      // Clear every existing key not in next by overwriting with undefined.
      for (const k of Object.keys(current)) {
        if (!(k in next)) next[k] = undefined;
      }
      const merged = settings.set(next);
      logger.info('Settings reset to defaults');
      return { ok: true, settings: merged };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('app:exportSettings', async (_e, destPath) => {
    try {
      const target = destPath || (await dialog.showSaveDialog({
        title: 'Export settings',
        defaultPath: `veloxa-settings-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })).filePath;
      if (!target) return { ok: false, cancelled: true };
      await fsp.writeFile(target, JSON.stringify(settings.get(), null, 2), 'utf8');
      logger.info(`Settings exported to ${target}`);
      return { ok: true, path: target };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('app:importSettings', async (_e, sourcePath) => {
    try {
      const source = sourcePath || (await dialog.showOpenDialog({
        title: 'Import settings',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })).filePaths[0];
      if (!source) return { ok: false, cancelled: true };
      const raw = await fsp.readFile(source, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('Not a settings object');
      const merged = settings.set(parsed);
      logger.info(`Settings imported from ${source}`);
      return { ok: true, settings: merged, path: source };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ---- File-size lookup (v2.6.0: Dashboard size summary) ----
  // Batched so the renderer can ask once instead of N IPC calls.
  ipcMain.handle('app:getFileSizes', async (_e, paths) => {
    if (!Array.isArray(paths)) return {};
    const sizes = {};
    await Promise.all(paths.map(async (p) => {
      try {
        const st = await fsp.stat(p);
        sizes[p] = st.size;
      } catch {
        sizes[p] = null;
      }
    }));
    return sizes;
  });

  // ---- System info for Performance Advisor (v2.6.0, GPU added v2.7.6) ----
  // Returns CPU + memory + arch (the original v2.6.0 shape that the
  // Performance Advisor / Settings panel already reads), AUGMENTED with
  // GPU detection from engine/sysinfo.js. Cached after first call.
  // Pass `{ refresh: true }` to force a re-probe (rare — hardware doesn't
  // change at runtime, but tests use it).
  ipcMain.handle('app:getSystemInfo', async (_e, opts = {}) => {
    const os = require('node:os');
    const cpus = os.cpus() || [];
    const cpuCores = cpus.length;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const totalRamGb = Math.round((totalMem / (1024 ** 3)) * 10) / 10;
    const freeRamGb = Math.round((freeMem / (1024 ** 3)) * 10) / 10;
    const cpuModel = cpus[0] ? cpus[0].model : 'Unknown';
    // Recommended concurrency: leave 2 cores for OS/UI, cap at 8 (diminishing
    // returns past that for the kind of work we do — most PDFs serialize on
    // pdf-lib's single-threaded zlib).
    const recommendedConcurrent = Math.max(2, Math.min(8, cpuCores - 2));

    // GPU probe — wmic on Win, system_profiler on Mac, lspci on Linux.
    // 5-second timeout per spawn; failure returns empty `gpus: []` rather
    // than throwing. We never use the GPU for actual document processing
    // (pdf-lib + pizzip + Office COM are all CPU-bound) — this is purely
    // informational so users see what the engine sees on their machine.
    let gpus = [];
    let gpuUsedByEngine = false;
    try {
      const sysinfo = require('../engine/sysinfo');
      const info = await sysinfo.getSystemInfo({ refresh: opts && opts.refresh });
      gpus = info.gpus || [];
      gpuUsedByEngine = !!info.gpuUsedByEngine;
    } catch { /* probe failed — silent */ }

    return {
      // Original v2.6.0 shape — Settings panel reads these fields directly
      cpuCores,
      cpuModel,
      totalRamGb,
      freeRamGb,
      platform: process.platform,
      arch: process.arch,
      recommendedConcurrent,
      // New v2.7.6 fields
      gpus,
      gpuUsedByEngine,
    };
  });

  // ---- Orphan-logo cleanup (Tier 1 #3) ----
  ipcMain.handle('app:cleanupOrphanLogos', async () => {
    try {
      const dir = logosDir();
      const all = await fsp.readdir(dir);
      const used = new Set(
        profiles.list()
          .map((p) => (p.logoPath || '').toLowerCase())
          .filter(Boolean),
      );
      let removed = 0;
      let bytesFreed = 0;
      for (const f of all) {
        const full = path.join(dir, f);
        if (used.has(full.toLowerCase())) continue;
        try {
          const stat = await fsp.stat(full);
          await fsp.unlink(full);
          removed += 1;
          bytesFreed += stat.size;
        } catch {}
      }
      if (removed > 0) logger.info(`Cleaned up ${removed} orphan logo(s), freed ${bytesFreed} bytes`);
      return { ok: true, removed, bytesFreed };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerIpcHandlers };
