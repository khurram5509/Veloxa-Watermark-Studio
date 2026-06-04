const { app, BrowserWindow, ipcMain, dialog, Menu, Notification, shell, Tray, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { registerIpcHandlers } = require('./ipc-handlers');

const isDev = process.env.NODE_ENV === 'development';

/**
 * Validate previously-saved window bounds against the current display layout.
 *
 * Cases handled:
 *   - The monitor those bounds were on has been disconnected → return null
 *     so we fall back to default centering on the primary display.
 *   - The window is sized larger than any current display (e.g. user
 *     unplugged their 4K and is on a 1080p laptop) → clamp to fit.
 *   - The window position would be partially off-screen → re-center on the
 *     closest display so the title bar stays grabbable.
 *
 * All of these manifested as "app opens off-screen, can't be moved" before.
 */
function safeWindowBounds(saved) {
  if (!saved) return null;
  if (!Number.isFinite(saved.width) || !Number.isFinite(saved.height)) return null;

  // Find the display the saved center point belongs to (or closest match).
  const cx = (saved.x || 0) + saved.width / 2;
  const cy = (saved.y || 0) + saved.height / 2;
  const displays = screen.getAllDisplays();
  if (!displays.length) return null;
  const match = screen.getDisplayNearestPoint({ x: cx, y: cy }) || displays[0];
  const work = match.workArea;

  // Clamp size to fit the matched display (90% of work area as a ceiling).
  let width  = Math.min(saved.width,  Math.floor(work.width  * 0.95));
  let height = Math.min(saved.height, Math.floor(work.height * 0.95));
  // Don't go below our hard minimums.
  width  = Math.max(width,  920);
  height = Math.max(height, 600);

  // Clamp position so at least 80px of the title bar is on-screen — that's
  // enough for the user to drag the window if it ends up partially clipped.
  const minOnscreen = 80;
  let x = saved.x;
  let y = saved.y;
  if (!Number.isFinite(x) || x + width  < work.x + minOnscreen || x > work.x + work.width  - minOnscreen) {
    x = Math.round(work.x + (work.width  - width)  / 2);
  }
  if (!Number.isFinite(y) || y + height < work.y + minOnscreen || y > work.y + work.height - minOnscreen) {
    y = Math.round(work.y + (work.height - height) / 2);
  }
  return { x, y, width, height, isMaximized: !!saved.isMaximized };
}

let mainWindow = null;
let tray = null;
let editorDirtyFlag = false;

function logFatal(scope, err) {
  const msg = `[${new Date().toISOString()}] ${scope}: ${err && err.stack ? err.stack : err}\n`;
  console.error(msg);
  try {
    const fp = path.join(app.getPath('userData'), 'startup-error.log');
    fs.appendFileSync(fp, msg);
  } catch {}
}

process.on('uncaughtException', (err) => logFatal('uncaughtException', err));
process.on('unhandledRejection', (err) => logFatal('unhandledRejection', err));

function createMainWindow() {
  // Restore previous window bounds if any — validated against current display
  // layout so an unplugged monitor doesn't strand the window off-screen.
  const settingsModule = require('../engine/settings');
  const savedBounds = safeWindowBounds(settingsModule.get().windowBounds);

  // Sized to fit HD (1280×720) @ 150% scaling = 853×480 effective pixels —
  // anything we ship below this risks unusable layouts. 920×600 fits there
  // comfortably while still being usable on a 4K display at 200% scale.
  mainWindow = new BrowserWindow({
    width: (savedBounds && savedBounds.width) || 1400,
    height: (savedBounds && savedBounds.height) || 900,
    x: savedBounds ? savedBounds.x : undefined,
    y: savedBounds ? savedBounds.y : undefined,
    minWidth: 920,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    title: 'Veloxa Watermark Studio',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // Lets the renderer apply per-display zoom factors (CSS rems then scale
      // appropriately for 100/125/150/200% Windows DPI settings).
      zoomFactor: 1.0,
    },
  });
  if (savedBounds && savedBounds.isMaximized) mainWindow.maximize();

  // If a display is added/removed/changed scaling while we're open, re-clamp
  // our bounds into the new layout so we don't end up off-screen. Debounced
  // to avoid thrash when the user is plugging cables.
  let displayRecheckTimer = null;
  const reclampToCurrentDisplays = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized()) return;
    if (displayRecheckTimer) clearTimeout(displayRecheckTimer);
    displayRecheckTimer = setTimeout(() => {
      try {
        const cur = mainWindow.getBounds();
        const safe = safeWindowBounds({ ...cur, isMaximized: false });
        if (safe && (safe.x !== cur.x || safe.y !== cur.y || safe.width !== cur.width || safe.height !== cur.height)) {
          mainWindow.setBounds({ x: safe.x, y: safe.y, width: safe.width, height: safe.height });
        }
      } catch {}
    }, 250);
  };
  screen.on('display-added',      reclampToCurrentDisplays);
  screen.on('display-removed',    reclampToCurrentDisplays);
  screen.on('display-metrics-changed', reclampToCurrentDisplays);

  // Persist window state on resize / move / maximize toggles, debounced.
  let saveTimer = null;
  const saveBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const isMax = mainWindow.isMaximized();
        const b = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
        settingsModule.set({ windowBounds: { ...b, isMaximized: isMax } });
      } catch {}
    }, 400);
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('maximize', saveBounds);
  mainWindow.on('unmaximize', saveBounds);

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('did-fail-load', code, desc, url);
    try {
      const fp = path.join(app.getPath('userData'), 'startup-error.log');
      fs.appendFileSync(fp, `[${new Date().toISOString()}] did-fail-load ${code} ${desc} ${url}\n`);
    } catch {}
  });

  // F12 toggles DevTools in production for end-user debugging
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
    if (input.type === 'keyDown' && input.key === 'r' && (input.control || input.meta)) {
      mainWindow.webContents.reload();
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Confirm-before-close when the queue still has work, OR when the
  // ProfileEditor has unsaved changes that would be lost.
  let confirmedClose = false;
  mainWindow.on('close', (e) => {
    if (confirmedClose) return;
    try {
      const queue = require('../engine/queue');
      const status = queue.status();
      const inflight = status.counts.running + status.counts.pending;

      const reasons = [];
      if (inflight > 0) reasons.push(`${inflight} job${inflight === 1 ? '' : 's'} still in progress`);
      if (editorDirtyFlag) reasons.push('a profile with unsaved changes');

      if (reasons.length > 0) {
        const message = `You have ${reasons.join(' and ')}.`;
        const detail = inflight > 0
          ? 'Quitting cancels pending jobs (the queue is saved and resumable). Unsaved profile changes will be discarded.'
          : 'Unsaved profile changes will be discarded.';
        const choice = dialog.showMessageBoxSync(mainWindow, {
          type: 'warning',
          buttons: ['Quit anyway', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          title: 'Confirm Quit — Veloxa Watermark Studio',
          message,
          detail,
          noLink: true,
        });
        if (choice === 1) {
          e.preventDefault();
          return;
        }
        confirmedClose = true;
      }
    } catch (err) {
      logFatal('close-handler', err);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
    if (!fs.existsSync(iconPath)) return;
    tray = new Tray(iconPath);
    tray.setToolTip('Veloxa Watermark Studio');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Veloxa', click: () => mainWindow?.show() },
        { type: 'separator' },
        { label: 'Quit', click: () => app.quit() },
      ]),
    );
    tray.on('click', () => mainWindow?.show());
  } catch (err) {
    console.warn('Tray init failed:', err.message);
  }
}

function setupSingleInstance() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      const fileArgs = argv.filter((a) => /\.(pdf|docx|pptx)$/i.test(a) && fs.existsSync(a));
      if (fileArgs.length) {
        mainWindow.webContents.send('files:imported', fileArgs);
      }
    }
  });
  return true;
}

if (!setupSingleInstance()) {
  // duplicate instance — exit early
} else {
  app.whenReady().then(() => {
    registerIpcHandlers({ getMainWindow: () => mainWindow });

    // Restore the queue from disk if a previous run was interrupted.
    try {
      const queue = require('../engine/queue');
      const restored = queue.restoreFromDisk();
      if (restored && (restored.pending > 0 || restored.interrupted > 0)) {
        // The renderer will receive the queue state via the standard
        // queue:updated event when it subscribes. We just log here.
        const logger = require('../engine/logger');
        logger.info(`Restored queue: ${restored.total} job(s) — ${restored.pending} pending, ${restored.interrupted} marked interrupted`);
      }
    } catch (err) {
      logFatal('queue-restore', err);
    }

    // Probe LibreOffice presence in the background so the Convert-to-PDF
    // feature has a cached availability state when the user opens the
    // profile editor or runs validation.
    try {
      const converter = require('../engine/converter');
      const logger = require('../engine/logger');
      converter.status().then((s) => {
        if (s.available) logger.info(`PDF converter detected: LibreOffice ${s.version || ''} at ${s.path}`);
        else logger.info('PDF converter: not installed (Convert-to-PDF will be disabled until LibreOffice is added)');
      }).catch(() => {});
    } catch {}

    createMainWindow();
    createTray();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });

    // Notify when ready
    if (Notification.isSupported()) {
      // soft startup ping disabled by default — uncomment if desired
      // new Notification({ title: 'Veloxa Watermark Studio', body: 'Ready for bulk processing.' }).show();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async () => {
    // Tear down worker threads cleanly so the process can exit promptly.
    try {
      const queue = require('../engine/queue');
      await queue.destroyPool();
    } catch {}
  });
}

const settingsModule = require('../engine/settings');

// Expose helper to renderer for taskbar progress
ipcMain.handle('window:setProgress', (_e, value) => {
  if (!mainWindow) return;
  if (!settingsModule.get().enableTaskbarProgress) {
    mainWindow.setProgressBar(-1);
    return;
  }
  if (typeof value === 'number' && value >= 0 && value <= 1) {
    mainWindow.setProgressBar(value);
  } else {
    mainWindow.setProgressBar(-1);
  }
});

ipcMain.handle('window:minimize', () => mainWindow?.minimize());
ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle('window:close', () => mainWindow?.close());
ipcMain.handle('app:notify', (_e, { title, body }) => {
  if (!settingsModule.get().enableNotifications) return;
  if (Notification.isSupported()) new Notification({ title, body }).show();
});
ipcMain.handle('app:openPath', (_e, p) => shell.openPath(p));
ipcMain.handle('app:showInFolder', (_e, p) => shell.showItemInFolder(p));
// External URL — strictly http(s) only so a stray openPath('https://...') call
// can't be tricked into running arbitrary local programs.
ipcMain.handle('app:openExternal', (_e, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'Only http/https URLs allowed' };
  }
  shell.openExternal(url);
  return { ok: true };
});

// Tell the renderer where logos live so it can show "Stored in app" badges
// and offer to migrate external paths.
ipcMain.handle('app:getLogosDir', () => {
  try {
    const { logosDir } = require('../engine/paths');
    return logosDir();
  } catch {
    return null;
  }
});

// Persist a logo file inside the app's data dir so the watermark survives the
// user moving / deleting the source. Returns the new absolute path, or the
// original on failure (so we degrade gracefully).
ipcMain.handle('app:saveLogoFile', async (_e, srcPath) => {
  if (!srcPath) return null;
  try {
    const { logosDir } = require('../engine/paths');
    const crypto = require('node:crypto');
    const ext = (path.extname(srcPath) || '.png').toLowerCase();
    // Hash content + size for stable dedupe — the same file produces the same managed path.
    const stat = await fs.promises.stat(srcPath);
    const buf = await fs.promises.readFile(srcPath);
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
    const dest = path.join(logosDir(), `${hash}_${stat.size}${ext}`);
    if (!fs.existsSync(dest)) await fs.promises.writeFile(dest, buf);
    return dest;
  } catch (err) {
    logFatal('app:saveLogoFile', err);
    return srcPath;
  }
});

// Renderer signals when the profile editor has unsaved changes so the close
// handler can warn before quitting and losing them. Module-scope flag so
// the close handler defined inside createMainWindow() can read it.
ipcMain.handle('app:setEditorDirty', (_e, dirty) => { editorDirtyFlag = !!dirty; });
ipcMain.handle('app:readImageDataUrl', async (_e, p) => {
  if (!p) return null;
  try {
    const ext = path.extname(p).toLowerCase().replace('.', '') || 'png';
    const mime = ext === 'jpg' ? 'jpeg' : (ext === 'svg' ? 'svg+xml' : ext);
    const buf = await fs.promises.readFile(p);
    return `data:image/${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
});
