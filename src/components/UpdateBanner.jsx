import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X as XIcon, ExternalLink, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';

/**
 * Top-of-dashboard banner that surfaces an available update.
 *
 * Visibility logic (driven by useStore.updater.status):
 *   - 'idle'        → hidden
 *   - 'available'   → "vX.Y.Z available — Download | Notes | Skip | Later"
 *   - 'downloading' → progress bar + cancel-equivalent (Later)
 *   - 'ready'       → "Downloaded — Install now | Show file | Later"
 *   - 'no-update'   → tiny green "you're up to date" toast (auto-hides after 4s)
 *   - 'error'       → red banner with the error message + retry
 */
export default function UpdateBanner() {
  const { updater, downloadUpdate, installUpdate, dismissUpdate, hideUpdateBanner, checkForUpdates } = useStore();
  const v = typeof window !== 'undefined' ? window.veloxa : null;

  // Subscribe to download progress events from the main process.
  useEffect(() => {
    if (!v || !v.on || !v.on.updateProgress) return;
    const off = v.on.updateProgress((p) => {
      useStore.setState((s) => ({ updater: { ...s.updater, progress: p } }));
    });
    return () => off && off();
  }, []);

  // Auto-hide "no-update" toast after 4s — it's a confirmation, not a banner.
  useEffect(() => {
    if (updater.status !== 'no-update') return;
    const t = setTimeout(() => hideUpdateBanner(), 4000);
    return () => clearTimeout(t);
  }, [updater.status]);

  if (updater.status === 'idle') return null;

  const info = updater.info || {};
  const latest = info.latest || '';
  const current = info.current || '';
  const releaseUrl = info.releaseUrl;

  return (
    <AnimatePresence>
      <motion.div
        key={`update-banner-${updater.status}`}
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      >
        {updater.status === 'available' && (
          <Available
            latest={latest} current={current} releaseUrl={releaseUrl} info={info}
            onDownload={downloadUpdate} onSkip={dismissUpdate} onLater={hideUpdateBanner}
          />
        )}
        {updater.status === 'downloading' && (
          <Downloading latest={latest} progress={updater.progress} onLater={hideUpdateBanner}/>
        )}
        {updater.status === 'ready' && (
          <Ready latest={latest} installerPath={updater.installerPath} onInstall={installUpdate} onLater={hideUpdateBanner}/>
        )}
        {updater.status === 'no-update' && (
          <NoUpdate current={current} onClose={hideUpdateBanner}/>
        )}
        {updater.status === 'error' && (
          <ErrorState message={updater.error} onRetry={() => checkForUpdates({ force: true })} onClose={hideUpdateBanner}/>
        )}
        {updater.status === 'checking' && (
          <Checking onClose={hideUpdateBanner}/>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function Available({ latest, current, releaseUrl, info, onDownload, onSkip, onLater }) {
  const v = typeof window !== 'undefined' ? window.veloxa : null;
  const sizeMb = info && info.asset && info.asset.size ? (info.asset.size / 1024 / 1024).toFixed(1) : null;
  return (
    <div className="surface-1 rounded-2xl px-5 py-3 flex items-center gap-4 border-veloxa-500/30 ring-1 ring-veloxa-500/30">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-veloxa-600/15 text-veloxa-400 border border-veloxa-500/30">
        <Download className="w-4 h-4"/>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink-100">
          Veloxa Watermark Studio <b className="text-veloxa-400">v{latest}</b> is available
        </div>
        <div className="text-xs text-muted">
          You're on v{current}{sizeMb ? <> · Installer size: {sizeMb} MB</> : null}
        </div>
      </div>
      {releaseUrl && (
        <button
          onClick={() => v && v.updater && v.updater.openReleaseUrl(releaseUrl)}
          className="btn-ghost text-xs"
          title="Open release notes on GitHub"
        >
          <ExternalLink className="w-3.5 h-3.5"/> Notes
        </button>
      )}
      <button onClick={onDownload} className="btn-primary text-xs" disabled={!info || !info.asset}>
        <Download className="w-3.5 h-3.5"/> Download
      </button>
      <button onClick={onSkip} className="btn-outline text-xs" title="Don't remind me about this version">
        Skip
      </button>
      <button onClick={onLater} className="btn-ghost p-1.5" title="Later">
        <XIcon className="w-4 h-4"/>
      </button>
    </div>
  );
}

function Downloading({ latest, progress, onLater }) {
  const pct = Math.max(0, Math.min(1, progress && progress.percent ? progress.percent : 0));
  const pctStr = `${Math.round(pct * 100)}%`;
  const receivedMb = progress && progress.received ? (progress.received / 1024 / 1024).toFixed(1) : '0.0';
  const totalMb = progress && progress.total ? (progress.total / 1024 / 1024).toFixed(1) : '?';
  // v2.6.4: bytesPerSec is reported by the engine — show speed + ETA so a slow
  // download doesn't look hung.
  const bps = (progress && progress.bytesPerSec) || 0;
  const speedStr = bps > 0 ? `${(bps / 1024 / 1024).toFixed(1)} MB/s` : '';
  const remaining = (progress && progress.total && bps > 0)
    ? Math.max(0, (progress.total - progress.received) / bps)
    : 0;
  const etaStr = remaining > 0
    ? remaining < 60 ? `${Math.round(remaining)}s left` : `${Math.round(remaining / 60)}m left`
    : '';
  return (
    <div className="surface-1 rounded-2xl px-5 py-3 flex items-center gap-4 border-veloxa-500/30 ring-1 ring-veloxa-500/30">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-veloxa-600/15 text-veloxa-400 border border-veloxa-500/30">
        <Loader2 className="w-4 h-4 animate-spin"/>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink-100">
          Downloading v{latest}…
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-ink-700 overflow-hidden">
          <div className="h-full bg-veloxa-500 transition-all" style={{ width: pctStr }}/>
        </div>
        <div className="text-xs text-muted mt-1 flex items-center gap-2 flex-wrap">
          <span>{receivedMb} MB / {totalMb} MB · {pctStr}</span>
          {speedStr && <span className="text-veloxa-300">· {speedStr}</span>}
          {etaStr && <span>· {etaStr}</span>}
        </div>
      </div>
      <button onClick={onLater} className="btn-ghost p-1.5" title="Hide">
        <XIcon className="w-4 h-4"/>
      </button>
    </div>
  );
}

function Ready({ latest, installerPath, onInstall, onLater }) {
  const v = typeof window !== 'undefined' ? window.veloxa : null;
  return (
    <div className="surface-1 rounded-2xl px-5 py-3 flex items-center gap-4 border-green-500/30 ring-1 ring-green-500/30">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-green-600/15 text-green-400 border border-green-500/30">
        <CheckCircle2 className="w-4 h-4"/>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink-100">v{latest} downloaded — ready to install</div>
        <div className="text-xs text-muted truncate" title={installerPath}>
          {installerPath}
        </div>
      </div>
      <button onClick={onInstall} className="btn-primary text-xs">
        <Download className="w-3.5 h-3.5"/> Install now
      </button>
      <button
        onClick={() => v && v.app && v.app.showInFolder && v.app.showInFolder(installerPath)}
        className="btn-outline text-xs"
        title="Reveal in File Explorer"
      >
        Show file
      </button>
      <button onClick={onLater} className="btn-ghost p-1.5" title="Later">
        <XIcon className="w-4 h-4"/>
      </button>
    </div>
  );
}

function NoUpdate({ current, onClose }) {
  return (
    <div className="surface-1 rounded-2xl px-5 py-3 flex items-center gap-4 border-green-500/30 ring-1 ring-green-500/30">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-green-600/15 text-green-400 border border-green-500/30">
        <CheckCircle2 className="w-4 h-4"/>
      </div>
      <div className="flex-1 text-sm text-ink-100">
        You're on the latest version (v{current}).
      </div>
      <button onClick={onClose} className="btn-ghost p-1.5" title="Dismiss">
        <XIcon className="w-4 h-4"/>
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry, onClose }) {
  return (
    <div className="surface-1 rounded-2xl px-5 py-3 flex items-center gap-4 border-red-500/30 ring-1 ring-red-500/30">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-red-600/15 text-red-400 border border-red-500/30">
        <AlertTriangle className="w-4 h-4"/>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-ink-100">Couldn't check for updates</div>
        <div className="text-xs text-muted truncate" title={message}>{message}</div>
      </div>
      <button onClick={onRetry} className="btn-outline text-xs">Retry</button>
      <button onClick={onClose} className="btn-ghost p-1.5" title="Dismiss">
        <XIcon className="w-4 h-4"/>
      </button>
    </div>
  );
}

function Checking({ onClose }) {
  return (
    <div className="surface-1 rounded-2xl px-5 py-3 flex items-center gap-4">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-ink-700/40 text-ink-100">
        <Loader2 className="w-4 h-4 animate-spin"/>
      </div>
      <div className="flex-1 text-sm text-ink-100">Checking for updates…</div>
      <button onClick={onClose} className="btn-ghost p-1.5" title="Hide">
        <XIcon className="w-4 h-4"/>
      </button>
    </div>
  );
}
