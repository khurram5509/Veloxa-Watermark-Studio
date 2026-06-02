const { contextBridge, ipcRenderer, webUtils } = require('electron');
let appVersion = 'unknown';
try { appVersion = require('../package.json').version || 'unknown'; } catch { /* dev mode without resolve */ }

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, listener) => {
  const subscription = (_event, ...args) => listener(...args);
  ipcRenderer.on(channel, subscription);
  return () => ipcRenderer.removeListener(channel, subscription);
};

contextBridge.exposeInMainWorld('veloxa', {
  // Window controls
  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    setProgress: (v) => invoke('window:setProgress', v),
  },

  // Dialogs / shell
  app: {
    notify: (title, body) => invoke('app:notify', { title, body }),
    openPath: (p) => invoke('app:openPath', p),
    openExternal: (url) => invoke('app:openExternal', url),
    showInFolder: (p) => invoke('app:showInFolder', p),
    pickFiles: () => invoke('dialog:pickFiles'),
    pickFolder: () => invoke('dialog:pickFolder'),
    pickImage: () => invoke('dialog:pickImage'),
    readImageDataUrl: (p) => invoke('app:readImageDataUrl', p),
    setEditorDirty: (dirty) => invoke('app:setEditorDirty', !!dirty),
    saveLogoFile: (srcPath) => invoke('app:saveLogoFile', srcPath),
    getLogosDir: () => invoke('app:getLogosDir'),
    listLogos: () => invoke('app:listLogos'),
    deleteLogo: (p) => invoke('app:deleteLogo', p),
    cleanupOrphanLogos: () => invoke('app:cleanupOrphanLogos'),
    checkConverter: (refresh) => invoke('app:checkConverter', !!refresh),
  },

  // File scanning
  scan: {
    paths: (paths) => invoke('scan:paths', paths),
  },

  // Profiles
  profiles: {
    list: () => invoke('profiles:list'),
    save: (profile) => invoke('profiles:save', profile),
    delete: (id) => invoke('profiles:delete', id),
    duplicate: (id) => invoke('profiles:duplicate', id),
    setDefault: (id) => invoke('profiles:setDefault', id),
    export: (id, dest) => invoke('profiles:export', id, dest),
    import: (src) => invoke('profiles:import', src),
  },

  // Settings
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },

  // Engine / queue
  engine: {
    enqueue: (files, profileId) => invoke('engine:enqueue', files, profileId),
    start: () => invoke('engine:start'),
    pause: () => invoke('engine:pause'),
    resume: () => invoke('engine:resume'),
    cancel: () => invoke('engine:cancel'),
    retryFailed: () => invoke('engine:retryFailed'),
    clearCompleted: () => invoke('engine:clearCompleted'),
    clearAll: () => invoke('engine:clearAll'),
    status: () => invoke('engine:status'),
    validateProfile: (profile) => invoke('engine:validateProfile', profile),
  },

  // Logs
  logs: {
    list: (limit) => invoke('logs:list', limit),
    clear: () => invoke('logs:clear'),
  },

  // Auto-updater (v2.5.0)
  updater: {
    check: (opts) => invoke('updater:check', opts || {}),
    download: (asset) => invoke('updater:download', asset),
    openInstaller: (p, opts) => invoke('updater:openInstaller', p, opts || {}),
    revealInstaller: (p) => invoke('updater:revealInstaller', p),
    dismissVersion: (v) => invoke('updater:dismissVersion', v),
    openReleaseUrl: (url) => invoke('updater:openReleaseUrl', url),
  },

  // Event subscriptions (return unsubscribe fn)
  on: {
    queueUpdated: (cb) => on('queue:updated', cb),
    queueProgress: (cb) => on('queue:progress', cb),
    queueDone: (cb) => on('queue:done', cb),
    log: (cb) => on('log:line', cb),
    filesImported: (cb) => on('files:imported', cb),
    updateProgress: (cb) => on('updater:progress', cb),
  },

  // Electron 32+ replaced File.path with webUtils.getPathForFile()
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); }
    catch { return ''; }
  },

  platform: process.platform,
  // versions: { app: '2.5.0', node, electron, chrome, ... }
  versions: { ...process.versions, app: appVersion },
});
