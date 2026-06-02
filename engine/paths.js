const path = require('node:path');
const fs = require('node:fs');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  return p;
}

let _userData = null;

/**
 * Resolve the per-user data directory.
 * Works both inside Electron (uses app.getPath('userData')) and standalone
 * (CLI / HTTP server / smoke tests) where Electron isn't available — falls
 * back to the OS conventional per-user app-data location.
 */
function userData() {
  if (_userData) return ensureDir(_userData);

  // Inside Electron: prefer app.getPath('userData')
  try {
    const electron = require('electron');
    const app = electron && electron.app;
    if (app && typeof app.getPath === 'function') {
      _userData = app.getPath('userData');
      return ensureDir(_userData);
    }
  } catch {
    // Not in Electron — fall through
  }

  // Standalone fallback
  const os = require('node:os');
  const home = os.homedir();
  if (process.platform === 'win32') {
    _userData = path.join(
      process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
      'Veloxa Watermark Studio',
    );
  } else if (process.platform === 'darwin') {
    _userData = path.join(home, 'Library', 'Application Support', 'Veloxa Watermark Studio');
  } else {
    _userData = path.join(
      process.env.XDG_CONFIG_HOME || path.join(home, '.config'),
      'Veloxa Watermark Studio',
    );
  }
  return ensureDir(_userData);
}

const dataDir = () => ensureDir(path.join(userData(), 'data'));
const logosDir = () => ensureDir(path.join(dataDir(), 'logos'));
const profilesFile = () => path.join(dataDir(), 'profiles.json');
const settingsFile = () => path.join(dataDir(), 'settings.json');
const logsFile = () => path.join(dataDir(), 'logs.jsonl');

module.exports = { ensureDir, userData, dataDir, logosDir, profilesFile, settingsFile, logsFile };
