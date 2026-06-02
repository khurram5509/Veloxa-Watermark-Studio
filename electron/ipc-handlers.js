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
  ipcMain.handle('engine:clearAll', () => queue.clearAll());
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

  ipcMain.handle('updater:check', async (_e, opts = {}) => {
    try {
      const result = await updater.check({
        currentVersion: app.getVersion(),
        repo: updateRepo,
        assetPattern,
        force: !!opts.force,
        settingsAdapter: updaterSettings,
      });
      return { ok: true, ...result };
    } catch (err) {
      logger.warn(`Update check failed: ${err.message}`);
      return { ok: false, error: err.message, current: app.getVersion() };
    }
  });

  ipcMain.handle('updater:download', async (_e, { url, name, size } = {}) => {
    if (!url) return { ok: false, error: 'No download URL' };
    try {
      const downloadsDir = app.getPath('downloads') || app.getPath('temp');
      const safeName = (name || 'VeloxaWatermarkStudio-Setup.exe').replace(/[\\/:*?"<>|]+/g, '_');
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

  ipcMain.handle('updater:openInstaller', async (_e, installerPath) => {
    if (!installerPath || !fs.existsSync(installerPath)) {
      return { ok: false, error: 'Installer file not found' };
    }
    // shell.openPath runs the .exe through the user's normal Windows handler;
    // they'll see the standard UAC / per-user installer prompt.
    const result = await shell.openPath(installerPath);
    if (result) return { ok: false, error: result };
    return { ok: true };
  });

  ipcMain.handle('updater:dismissVersion', async (_e, version) => {
    if (!version) return { ok: false };
    settings.set({ dismissedUpdateVersion: String(version) });
    return { ok: true };
  });

  ipcMain.handle('updater:openReleaseUrl', async (_e, url) => {
    if (typeof url !== 'string' || !/^https:\/\/github\.com\//i.test(url)) {
      return { ok: false, error: 'Only github.com URLs allowed' };
    }
    shell.openExternal(url);
    return { ok: true };
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
