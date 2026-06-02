const fs = require('node:fs');
const { settingsFile } = require('./paths');

const DEFAULTS = {
  theme: 'dark',
  outputMode: 'original',
  customOutputDir: '',
  namingTemplate: '{originalname}_WM_{counter}',
  startCounter: 1,
  counterPadding: 3,
  maxConcurrent: 4,
  memoryFriendly: false,
  startMinimized: false,
  enableNotifications: true,
  enableTaskbarProgress: true,
  defaultProfileId: null,
  pdfPassword: '',
  pdfCompression: 'standard',
  skipAlreadyWatermarked: true,
  recentProfileIds: [],
  windowBounds: null,
  // PDF converter backend preference: 'auto' | 'msoffice' | 'libreoffice'
  pdfConverter: 'auto',
  // Auto-update behavior (v2.5.0): 'on-startup' | 'manual' | 'never'.
  // 'on-startup' = check once per 24h after window opens; 'manual' = only
  // when the user clicks "Check for Updates"; 'never' = disable entirely.
  checkForUpdates: 'on-startup',
  // Stamps from the updater for the daily debounce and skip-this-version UX.
  lastUpdateCheckMs: null,
  cachedLatestRelease: null,
  dismissedUpdateVersion: null,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    cache = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    cache = { ...DEFAULTS };
    persist();
  }
  return cache;
}

function persist() {
  fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2), 'utf8');
}

function get() {
  return load();
}

function set(patch) {
  load();
  cache = { ...cache, ...patch };
  persist();
  return cache;
}

module.exports = { get, set, DEFAULTS };
