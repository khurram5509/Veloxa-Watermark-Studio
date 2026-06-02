import { create } from 'zustand';

const v = typeof window !== 'undefined' ? window.veloxa : null;

export const useStore = create((set, get) => ({
  // Navigation
  view: 'dashboard', // dashboard | profiles | logs | settings
  setView: (view) => set({ view }),

  // Theme
  theme: 'dark',
  setTheme: async (theme) => {
    set({ theme });
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme !== 'light');
    if (v) await v.settings.set({ theme });
  },

  // Profiles
  profiles: [],
  selectedProfileId: null,
  editingProfile: null,
  renamingProfileId: null,
  setRenamingProfileId: (id) => set({ renamingProfileId: id }),
  loadProfiles: async () => {
    if (!v) return;
    const profiles = await v.profiles.list();
    const def = profiles.find((p) => p.isDefault) || profiles[0];
    const cur = get().selectedProfileId;
    const stillExists = cur && profiles.some((p) => p.id === cur);
    set({ profiles, selectedProfileId: stillExists ? cur : (def?.id || null) });
  },
  setSelectedProfile: (id) => set({ selectedProfileId: id }),
  startEditingProfile: (profile) => set({ editingProfile: profile || makeBlankProfile() }),
  cancelEditingProfile: () => set({ editingProfile: null }),

  // Settings
  settings: null,
  loadSettings: async () => {
    if (!v) return;
    const s = await v.settings.get();
    set({ settings: s, theme: s.theme || 'dark' });
    document.documentElement.classList.toggle('light', s.theme === 'light');
    document.documentElement.classList.toggle('dark', s.theme !== 'light');
  },
  updateSettings: async (patch) => {
    if (!v) return;
    const s = await v.settings.set(patch);
    set({ settings: s });
  },

  // Queue
  queue: { jobs: [], paused: false, running: false, counts: { total: 0, pending: 0, running: 0, success: 0, failed: 0, skipped: 0 } },
  setQueue: (state) => set({ queue: state }),

  // Logs
  logs: [],
  loadLogs: async () => {
    if (!v) return;
    const list = await v.logs.list(500);
    set({ logs: list });
  },
  appendLog: (line) => set((s) => ({ logs: [...s.logs.slice(-499), line] })),
  clearLogs: async () => {
    if (!v) return;
    await v.logs.clear();
    set({ logs: [] });
  },

  // Drop staging
  pendingFiles: [],
  setPendingFiles: (files) => set({ pendingFiles: files }),
  addPendingFiles: (files) => set((s) => ({ pendingFiles: Array.from(new Set([...s.pendingFiles, ...files])) })),
  clearPendingFiles: () => set({ pendingFiles: [] }),

  // Help modal
  helpOpen: false,
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),

  // Resume banner — set on launch if the queue was restored from disk with
  // interrupted/pending jobs. Cleared by Resume / Discard / X.
  restoreBanner: null,
  setRestoreBanner: (info) => set({ restoreBanner: info }),
  clearRestoreBanner: () => set({ restoreBanner: null }),

  // Multi-select for bulk profile actions
  selectedProfileIdSet: new Set(),
  toggleProfileSelected: (id) => set((s) => {
    const next = new Set(s.selectedProfileIdSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { selectedProfileIdSet: next };
  }),
  clearSelectedProfiles: () => set({ selectedProfileIdSet: new Set() }),

  // Folder-import picker (shown when a folder is scanned so the user can
  // filter by type before files land in pendingFiles). Holds the raw scan
  // result `{ files, byType }` or null when closed.
  pendingFolderImport: null,
  showFolderImport: (scan) => set({ pendingFolderImport: scan }),
  hideFolderImport: () => set({ pendingFolderImport: null }),

  // Auto-updater state (v2.5.0).
  //   status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'no-update' | 'error'
  //   info: { latest, current, asset, releaseUrl, body, dismissed } | null
  //   progress: { received, total, percent } | null
  //   installerPath: string | null  — set once download finishes
  //   error: string | null
  updater: { status: 'idle', info: null, progress: null, installerPath: null, error: null },
  setUpdater: (patch) => set((s) => ({ updater: { ...s.updater, ...patch } })),

  // Auto-update check.
  //
  //   opts.force  — bypass the 24h server-side debounce
  //   opts.silent — for the automatic startup check: don't broadcast
  //                 'checking' or 'no-update' status (so users don't get a
  //                 "you're up to date" toast every launch). Only surfaces
  //                 an 'available' update or stays silent.
  //
  // The Settings panel's "Check now" button always passes silent=false so
  // its inline status indicator actually shows something — that was the
  // "Check now gives no feedback" bug.
  checkForUpdates: async ({ force = false, silent = false } = {}) => {
    if (!v || !v.updater) return;
    if (!silent) set((s) => ({ updater: { ...s.updater, status: 'checking', error: null } }));
    const result = await v.updater.check({ force });
    if (!result.ok) {
      if (silent) return result;
      set({ updater: { status: 'error', info: null, progress: null, installerPath: null, error: result.error } });
      return result;
    }
    if (result.hasUpdate && !result.dismissed) {
      // Always surface an available update, even when silent — that's the
      // whole point of background checking.
      set({ updater: { status: 'available', info: result, progress: null, installerPath: null, error: null } });
    } else if (!silent) {
      set({ updater: { status: 'no-update', info: result, progress: null, installerPath: null, error: null } });
    }
    return result;
  },
  downloadUpdate: async () => {
    if (!v || !v.updater) return;
    const info = get().updater.info;
    if (!info || !info.asset) return;
    set((s) => ({ updater: { ...s.updater, status: 'downloading', progress: { received: 0, total: info.asset.size || 0, percent: 0 }, error: null } }));
    const result = await v.updater.download({ url: info.asset.url, name: info.asset.name, size: info.asset.size });
    if (!result.ok) {
      set((s) => ({ updater: { ...s.updater, status: 'error', error: result.error } }));
      return result;
    }
    set((s) => ({ updater: { ...s.updater, status: 'ready', installerPath: result.path, error: null } }));
    return result;
  },
  installUpdate: async () => {
    if (!v || !v.updater) return;
    const p = get().updater.installerPath;
    if (!p) return;
    await v.updater.openInstaller(p);
  },
  dismissUpdate: async () => {
    if (!v || !v.updater) return;
    const info = get().updater.info;
    if (info && info.latest) await v.updater.dismissVersion(info.latest);
    set({ updater: { status: 'idle', info: null, progress: null, installerPath: null, error: null } });
  },
  hideUpdateBanner: () => set((s) => ({ updater: { ...s.updater, status: 'idle' } })),
}));

export function makeBlankProfile() {
  return {
    id: null,
    name: 'New Profile',
    type: 'text',
    text: 'CONFIDENTIAL',
    logoPath: '',
    fontFamily: 'Helvetica',
    fontSize: 72,
    fontColor: '#1F3DF5',
    bold: true,
    italic: false,
    opacity: 1.0,           // 100% by default
    rotation: 0,            // flat by default
    position: 'center',
    offsetX: 0,             // fine-tune horizontal offset (points; +right)
    offsetY: 0,             // fine-tune vertical offset (points; +down)
    scale: 1,
    margin: 48,
    pages: 'all',
    customPages: '',
    namingTemplate: '{originalname}_WM_{counter}',
    convertToPdf: false,        // post-process DOCX/PPTX → PDF via Office or LibreOffice
    pdfQuality: 'standard',     // 'standard' | 'high' — fidelity / file-size trade-off
    isDefault: false,
  };
}
