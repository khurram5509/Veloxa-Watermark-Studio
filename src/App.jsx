import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Files, CheckCircle2, XCircle, Activity, Layers, Sparkles,
  AlertTriangle, RotateCcw, X as XIcon, Clock,
} from 'lucide-react';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import DropZone from './components/DropZone';
import QueuePanel from './components/QueuePanel';
import ProfilesPanel from './components/ProfilesPanel';
import ProfileEditor from './components/ProfileEditor';
import LogsPanel from './components/LogsPanel';
import SettingsPanel from './components/SettingsPanel';
import StatCard from './components/StatCard';
import HelpModal from './components/HelpModal';
import FolderImportModal from './components/FolderImportModal';
import UpdateBanner from './components/UpdateBanner';
import { useStore } from './store/useStore';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

function useEngineWiring() {
  const { setQueue, appendLog, loadProfiles, loadSettings, loadLogs, setRestoreBanner, checkForUpdates } = useStore();
  const v = window.veloxa;

  useEffect(() => {
    if (!v) return;
    (async () => {
      await loadSettings();
      await loadProfiles();
      await loadLogs();
      const status = await v.engine.status();
      setQueue(status);

      // Resume banner: if the queue restored from disk has interrupted /
      // pending jobs, surface a banner on launch so the user can decide.
      const interrupted = status.jobs.filter((j) => /Interrupted/i.test(j.error || '')).length;
      const pending = status.counts.pending;
      if (interrupted > 0 || pending > 0) {
        setRestoreBanner({ interrupted, pending, total: status.jobs.length });
      }

      // Background update check (v2.5.0). Respects the user's preference and
      // the daily debounce stamped into settings.lastUpdateCheckMs.
      // silent=true so users don't get a "you're up to date" toast on every
      // launch — only an actual available update shows the banner.
      const cfg = useStore.getState().settings;
      if (cfg && cfg.checkForUpdates !== 'never' && cfg.checkForUpdates !== 'manual') {
        // Delay 2s so we don't compete with the renderer's first paint.
        setTimeout(() => { checkForUpdates({ force: false, silent: true }).catch(() => {}); }, 2000);
      }
    })();

    const offUpdated = v.on.queueUpdated((s) => setQueue(s));
    const offProgress = v.on.queueProgress(({ fraction }) => {
      v.window.setProgress(fraction).catch(() => {});
    });
    const offDone = v.on.queueDone(({ success, failed }) => {
      v.app.notify('Veloxa Watermark Studio',
        `Run complete — ${success} succeeded, ${failed} failed.`).catch(() => {});
      v.window.setProgress(-1).catch(() => {});
    });
    const offLog = v.on.log((line) => appendLog(line));

    return () => {
      offUpdated?.(); offProgress?.(); offDone?.(); offLog?.();
    };
  }, []);
}

export default function App() {
  useEngineWiring();
  const {
    view, queue, profiles, selectedProfileId, pendingFiles,
    clearPendingFiles, helpOpen, openHelp, closeHelp,
    loadSettings,
  } = useStore();
  const v = window.veloxa;

  // Centralized keyboard shortcuts — see src/hooks/useGlobalShortcuts.js
  const handleProcessRef = React.useRef(null);
  const onProcessShortcut = React.useCallback(() => handleProcessRef.current?.(), []);
  useGlobalShortcuts({ onProcess: onProcessShortcut });

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId)
    || profiles.find((p) => p.isDefault)
    || profiles[0];

  const canProcess = pendingFiles.length > 0 && selectedProfile && !queue.running;

  const handleProcess = async () => {
    if (!canProcess) return;
    // Validate the selected profile up-front. A bad logoPath or invalid page
    // range otherwise fails every job one-by-one with the same generic error.
    try {
      const result = await v?.engine.validateProfile?.(selectedProfile);
      if (result && !result.ok) {
        const lines = result.errors.join('\n• ');
        const proceed = window.confirm(
          `Profile "${selectedProfile.name}" has issues:\n\n• ${lines}\n\nProcess anyway?`,
        );
        if (!proceed) return;
      }
    } catch {
      /* validation IPC unavailable — proceed */
    }
    await v?.engine.enqueue(pendingFiles, selectedProfile.id);
    await v?.engine.start();
    clearPendingFiles();
    // The engine just bumped settings.recentProfileIds on disk — re-load so
    // the RecentProfiles chips on the Dashboard reflect the new ordering.
    await loadSettings();
  };
  // Keep the ref in sync with the latest handleProcess closure (so Ctrl+Enter
  // always fires the version that sees the current pendingFiles + selectedProfile).
  // Done in an effect rather than during render so we don't mutate refs in render.
  useEffect(() => {
    handleProcessRef.current = handleProcess;
  });

  return (
    <div className="h-screen flex flex-col bg-ink-900">
      <TitleBar/>
      <div className="flex-1 flex min-h-0">
        <Sidebar/>
        <main className="flex-1 min-w-0 overflow-hidden">
          {view === 'dashboard' && (
            <Dashboard
              canProcess={canProcess}
              selectedProfile={selectedProfile}
              onProcess={handleProcess}
            />
          )}
          {view === 'profiles' && <ProfilesView/>}
          {view === 'logs' && <LogsView/>}
          {view === 'settings' && <SettingsView/>}
        </main>
      </div>
      <ProfileEditor/>
      <HelpModal open={helpOpen} onClose={closeHelp}/>
      <FolderImportModal/>
    </div>
  );
}

function Dashboard({ canProcess, selectedProfile, onProcess }) {
  const { queue, pendingFiles } = useStore();
  return (
    <div className="h-full flex flex-col p-5 gap-5">
      <UpdateBanner/>
      <ResumeBanner/>
      <Header pending={pendingFiles.length} canProcess={canProcess} selectedProfile={selectedProfile} onProcess={onProcess}/>
      <RecentProfiles/>

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Files} label="In Queue" value={queue.counts.total} accent="ink"/>
        <StatCard icon={Activity} label="Processing" value={queue.counts.running + queue.counts.pending} accent="veloxa"/>
        <StatCard icon={CheckCircle2} label="Completed" value={queue.counts.success} accent="green"/>
        <StatCard icon={XCircle} label="Failed" value={queue.counts.failed} accent="red"/>
      </div>

      <div className="grid grid-cols-3 gap-5 flex-1 min-h-0">
        <div className="col-span-2 flex flex-col gap-5 min-h-0">
          <DropZone/>
          <QueuePanel/>
        </div>
        <div className="flex flex-col gap-5 min-h-0">
          <ProfilesPanel compact/>
          <LogsPanel compact/>
        </div>
      </div>
    </div>
  );
}

function ResumeBanner() {
  const { restoreBanner, clearRestoreBanner } = useStore();
  const v = window.veloxa;

  const onResume = async () => {
    if (!restoreBanner) return;
    if (restoreBanner.interrupted > 0) await v?.engine.retryFailed();
    if (restoreBanner.pending > 0) await v?.engine.start();
    clearRestoreBanner();
  };
  const onDiscard = async () => {
    await v?.engine.clearAll();
    clearRestoreBanner();
  };

  return (
    <AnimatePresence>
      {restoreBanner && (
        <motion.div
          key="resume-banner"
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          className="surface-1 rounded-2xl px-5 py-3 flex items-center gap-4 border-amber-500/30 ring-1 ring-amber-500/30"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-amber-600/15 text-amber-400 border border-amber-500/30">
            <RotateCcw className="w-4 h-4"/>
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-ink-100">
              Restored {restoreBanner.total} job{restoreBanner.total === 1 ? '' : 's'} from your last session
            </div>
            <div className="text-xs text-muted">
              {restoreBanner.interrupted > 0 && <>{restoreBanner.interrupted} marked <b>Interrupted</b></>}
              {restoreBanner.interrupted > 0 && restoreBanner.pending > 0 && ', '}
              {restoreBanner.pending > 0 && <>{restoreBanner.pending} still <b>pending</b></>}
              {' '}— resume to retry, or discard to clear the queue.
            </div>
          </div>
          <button onClick={onResume} className="btn-primary text-xs">
            <Play className="w-3.5 h-3.5"/> Resume
          </button>
          <button onClick={onDiscard} className="btn-outline text-xs">
            <XIcon className="w-3.5 h-3.5"/> Discard
          </button>
          <button onClick={clearRestoreBanner} className="btn-ghost p-1.5" title="Dismiss">
            <XIcon className="w-4 h-4"/>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function RecentProfiles() {
  const { profiles, selectedProfileId, setSelectedProfile, settings } = useStore();
  const recentIds = (settings && settings.recentProfileIds) || [];
  const recents = recentIds
    .map((id) => profiles.find((p) => p.id === id))
    .filter(Boolean)
    .slice(0, 5);
  if (recents.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Clock className="w-3.5 h-3.5 text-muted shrink-0"/>
      <span className="text-[11px] uppercase tracking-widest text-muted shrink-0">Recent</span>
      {recents.map((p) => {
        const active = p.id === selectedProfileId;
        return (
          <button
            key={p.id}
            onClick={() => setSelectedProfile(p.id)}
            className={`chip cursor-pointer transition-all ${
              active
                ? 'border-veloxa-500 bg-veloxa-600/20 text-white'
                : 'border-ink-500/40 text-ink-100 hover:border-veloxa-500/50 hover:bg-veloxa-600/10'
            }`}
            title={`Use "${p.name}" for the next batch`}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: p.fontColor || '#5e87ff' }}
            />
            {p.name}
          </button>
        );
      })}
    </div>
  );
}

function Header({ pending, canProcess, selectedProfile, onProcess }) {
  return (
    <div className="surface-1 rounded-2xl px-5 py-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-veloxa-400"/>
          <h1 className="text-lg font-bold tracking-tight">Automated Bulk Document Watermarking</h1>
        </div>
        <p className="text-xs text-muted mt-1">
          {pending > 0
            ? <>Ready to process <b className="text-ink-100">{pending}</b> file{pending === 1 ? '' : 's'} with profile <b className="text-veloxa-400">{selectedProfile?.name || '—'}</b></>
            : <>Drop files or folders below, pick a profile, then click <b className="text-veloxa-400">PROCESS</b>.</>}
        </p>
      </div>
      <motion.button
        whileHover={canProcess ? { scale: 1.02 } : {}}
        whileTap={canProcess ? { scale: 0.98 } : {}}
        onClick={onProcess}
        disabled={!canProcess}
        className={`btn px-6 py-3 text-sm font-bold uppercase tracking-widest gap-3 ${
          canProcess
            ? 'gradient-veloxa text-white shadow-glow'
            : 'bg-ink-700/60 text-ink-200/40 cursor-not-allowed'
        }`}
      >
        <Play className="w-4 h-4"/> Process
      </motion.button>
    </div>
  );
}

function ProfilesView() {
  const { profiles, selectedProfileId, loadProfiles, startEditingProfile } = useStore();
  const v = window.veloxa;
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = React.useRef(0);

  // Drag-drop on Profiles screen:
  //  • PNG/JPG  → start editing the selected (or first) profile with that logo set
  //  • JSON     → import as a new profile
  useEffect(() => {
    // Skip if a modal is open — we don't want to silently replace the
    // profile being edited or steal focus from Help / folder-import picker.
    const modalOpen = () => {
      const s = useStore.getState();
      return !!s.editingProfile || !!s.helpOpen || !!s.pendingFolderImport;
    };

    const onDragEnter = (e) => { e.preventDefault(); if (modalOpen()) return; dragDepth.current += 1; setDragActive(true); };
    const onDragLeave = (e) => { e.preventDefault(); if (modalOpen()) return; dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragActive(false); }};
    const onDragOver = (e) => { e.preventDefault(); };
    const onDrop = async (e) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      if (modalOpen()) return;
      const files = Array.from(e.dataTransfer.files || []);
      const paths = files
        .map((f) => v?.getPathForFile ? v.getPathForFile(f) : f.path)
        .filter(Boolean);
      if (!paths.length) return;

      const isImg = (p) => /\.(png|jpe?g)$/i.test(p);
      const isJson = (p) => /\.json$/i.test(p);

      // Import any JSON profiles
      for (const p of paths.filter(isJson)) {
        await v?.profiles.import(p);
      }
      if (paths.some(isJson)) await loadProfiles();

      // Use the first image to update or create a profile.
      // Persist the logo into app data dir so the watermark survives source-file moves.
      const firstImg = paths.find(isImg);
      if (firstImg) {
        const savedLogo = (await v?.app.saveLogoFile?.(firstImg)) || firstImg;
        const target = profiles.find((x) => x.id === selectedProfileId)
          || profiles.find((x) => x.isDefault)
          || profiles[0];
        if (target) {
          startEditingProfile({
            ...target,
            type: target.type === 'text' ? 'combined' : target.type,
            logoPath: savedLogo,
          });
        } else {
          startEditingProfile({
            id: null, name: 'New Profile from logo', type: 'image',
            text: '', logoPath: savedLogo, fontFamily: 'Helvetica', fontSize: 72,
            fontColor: '#1F3DF5', bold: true, italic: false,
            opacity: 1, rotation: 0, position: 'center',
            offsetX: 0, offsetY: 0, scale: 1, margin: 48,
            pages: 'all', customPages: '',
            namingTemplate: '{originalname}_WM_{counter}', isDefault: false,
          });
        }
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [profiles, selectedProfileId]);

  return (
    <div className={`h-full p-5 grid grid-cols-3 gap-5 transition-colors ${dragActive ? 'bg-veloxa-600/5' : ''}`}>
      <div className="col-span-2"><ProfilesPanel/></div>
      <div className="surface-1 rounded-2xl p-5">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Layers className="w-4 h-4 text-veloxa-400"/> About profiles
        </h3>
        <p className="text-xs text-muted leading-relaxed">
          Profiles bundle every watermark setting — text, logo, position, opacity, rotation,
          page targeting, and the output naming template — into a reusable preset.
        </p>
        <ul className="text-xs text-muted leading-relaxed mt-3 space-y-1.5 list-disc list-inside">
          <li>Tag a profile as <b>default</b> to use it automatically on new runs.</li>
          <li><b>Double-click</b> a profile name to rename it inline.</li>
          <li>Drop a <b>PNG/JPG</b> here to set it as the logo on the selected profile.</li>
          <li>Drop a <b>JSON</b> file here to import a profile.</li>
          <li>Per-profile naming templates override the global setting.</li>
        </ul>
        <div className={`mt-4 rounded-xl border-2 border-dashed p-5 text-center text-xs transition-colors ${
          dragActive ? 'border-veloxa-500 bg-veloxa-600/10 text-white' : 'border-ink-500/40 text-muted'
        }`}>
          {dragActive ? 'Drop to import / set logo' : 'Drag & drop a logo or profile JSON here'}
        </div>
      </div>
    </div>
  );
}

function LogsView() {
  return (
    <div className="h-full p-5">
      <LogsPanel/>
    </div>
  );
}

function SettingsView() {
  // overflow-hidden on the outer wrapper so the SettingsPanel's main column
  // owns the scrollbar — that's what the sticky left-rail nav anchors to.
  return (
    <div className="h-full p-5 overflow-hidden">
      <SettingsPanel/>
    </div>
  );
}
