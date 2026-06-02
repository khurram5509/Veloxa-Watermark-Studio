import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import {
  FolderOpen, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Download,
  ExternalLink, Loader2, Github, Info, Layers,
} from 'lucide-react';
import { bytes as fmtBytes, relativeTime } from '../utils/format';

export default function SettingsPanel() {
  const { settings, updateSettings } = useStore();
  const v = window.veloxa;
  const [cleanupResult, setCleanupResult] = useState(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  if (!settings) return null;

  const set = (patch) => updateSettings(patch);

  const runOrphanCleanup = async () => {
    setCleanupRunning(true);
    setCleanupResult(null);
    try {
      const r = await v?.app.cleanupOrphanLogos();
      setCleanupResult(r);
    } catch (err) {
      setCleanupResult({ ok: false, error: err.message });
    } finally {
      setCleanupRunning(false);
    }
  };

  const pickCustomDir = async () => {
    const dir = await v?.app.pickFolder();
    if (dir) set({ customOutputDir: dir, outputMode: 'custom' });
  };

  return (
    <div className="surface-1 rounded-2xl p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold mb-1">Settings</h2>
          <p className="text-xs text-muted">All settings are saved locally and apply to every run.</p>
        </div>
        <AppVersionBadge/>
      </div>

      <Section title="Output">
        <Row label="Save processed files">
          <select className="select" value={settings.outputMode}
                  onChange={(e) => set({ outputMode: e.target.value })}>
            <option value="original">In the original folder</option>
            <option value="custom">In a custom folder</option>
          </select>
        </Row>
        {settings.outputMode === 'custom' && (
          <Row label="Custom output folder">
            <div className="flex gap-2">
              <input className="input flex-1" value={settings.customOutputDir || ''} readOnly placeholder="No folder selected"/>
              <button className="btn-outline" onClick={pickCustomDir}>
                <FolderOpen className="w-4 h-4"/> Browse
              </button>
            </div>
          </Row>
        )}
        <Row label="Default naming template" hint="Tokens: {originalname} {counter} {date} {time} {profile}">
          <input className="input" value={settings.namingTemplate}
                 onChange={(e) => set({ namingTemplate: e.target.value })}/>
        </Row>
        <div className="grid grid-cols-2 gap-4">
          <Row label="Counter starts at" hint="Restarts at this value for every new batch">
            <input type="number" className="input" min={1} value={settings.startCounter}
                   onChange={(e) => set({ startCounter: Number(e.target.value) })}/>
          </Row>
          <Row label="Counter padding" hint="Zero-pad the {counter} token (e.g. 3 → 001)">
            <input type="number" className="input" min={1} max={8} value={settings.counterPadding}
                   onChange={(e) => set({ counterPadding: Number(e.target.value) })}/>
          </Row>
        </div>
      </Section>

      <Section title="Performance">
        <Row label="Max concurrent jobs" hint="Higher = faster, more memory">
          <input type="number" className="input" min={1} max={16} value={settings.maxConcurrent}
                 onChange={(e) => set({ maxConcurrent: Number(e.target.value) })}/>
        </Row>
        <Row label="Memory-friendly mode" hint="Lower memory at the cost of throughput">
          <Toggle checked={!!settings.memoryFriendly}
                  onChange={(v) => set({ memoryFriendly: v })}/>
        </Row>
      </Section>

      <Section title="PDF export">
        <Row label="Compression">
          <select className="select" value={settings.pdfCompression}
                  onChange={(e) => set({ pdfCompression: e.target.value })}>
            <option value="none">None</option>
            <option value="standard">Standard</option>
          </select>
        </Row>
        <Row label="Convert-to-PDF backend" hint="Used when a profile has 'Convert output to PDF' enabled">
          <select className="select" value={settings.pdfConverter || 'auto'}
                  onChange={(e) => set({ pdfConverter: e.target.value })}>
            <option value="auto">Auto — prefer Microsoft Office for DOCX/PPTX, fall back to LibreOffice</option>
            <option value="msoffice">Microsoft Office only (Word for DOCX, PowerPoint for PPTX)</option>
            <option value="libreoffice">LibreOffice only (soffice headless)</option>
          </select>
        </Row>
      </Section>

      <Section title="Conflict detection">
        <Row
          label="Skip already-watermarked files"
          hint="If a file already has a Veloxa watermark, mark it Skipped instead of doubling up"
        >
          <Toggle
            checked={settings.skipAlreadyWatermarked !== false}
            onChange={(val) => set({ skipAlreadyWatermarked: val })}
          />
        </Row>
      </Section>

      <Section title="Storage">
        <Row
          label="Clean up orphan logos"
          hint="Delete logo files in data/logos/ that no profile references"
        >
          <button
            onClick={runOrphanCleanup}
            disabled={cleanupRunning}
            className="btn-outline"
          >
            <Trash2 className="w-3.5 h-3.5"/>
            {cleanupRunning ? 'Scanning…' : 'Run cleanup'}
          </button>
        </Row>
        {cleanupResult && (
          <div className={`text-xs px-3 py-2 rounded-lg ${
            cleanupResult.ok
              ? 'bg-emerald-600/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-rose-600/10 border border-rose-500/30 text-rose-300'
          }`}>
            {cleanupResult.ok
              ? cleanupResult.removed > 0
                ? `Removed ${cleanupResult.removed} orphan logo${cleanupResult.removed === 1 ? '' : 's'}, freed ${fmtBytes(cleanupResult.bytesFreed)}.`
                : 'No orphan logos found — every file in the library is referenced by a profile.'
              : `Cleanup failed: ${cleanupResult.error}`}
          </div>
        )}
      </Section>

      <Section title="Application">
        <Row label="Show desktop notifications">
          <Toggle checked={!!settings.enableNotifications}
                  onChange={(v) => set({ enableNotifications: v })}/>
        </Row>
        <Row label="Show progress in taskbar">
          <Toggle checked={!!settings.enableTaskbarProgress}
                  onChange={(v) => set({ enableTaskbarProgress: v })}/>
        </Row>
      </Section>

      <UpdatesSection settings={settings} set={set}/>
    </div>
  );
}

function AppVersionBadge() {
  const v = typeof window !== 'undefined' ? window.veloxa : null;
  const appV = (v && v.versions && v.versions.app) || 'dev';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="px-2 py-1 rounded-full bg-veloxa-600/15 text-veloxa-300 border border-veloxa-500/30 font-mono">
        v{appV}
      </span>
    </div>
  );
}

/**
 * Updates section — handles GitHub Releases auto-update with INLINE feedback.
 *
 * Before this rewrite, clicking "Check now" set the global updater state which
 * is rendered by <UpdateBanner/> on the Dashboard. If you were on the Settings
 * screen, nothing visibly changed and the click felt like a no-op. This
 * component now mirrors the same status inline so you always see what
 * happened, regardless of which view you're on.
 *
 * It also force-re-renders every 60 s so the "Last checked: 2 minutes ago"
 * label stays accurate without requiring a click.
 */
function UpdatesSection({ settings, set }) {
  const { checkForUpdates, updater, downloadUpdate, installUpdate, dismissUpdate } = useStore();
  const v = typeof window !== 'undefined' ? window.veloxa : null;
  const [, forceTick] = useState(0);
  // Tick once a minute so the relative-time label refreshes itself.
  useEffect(() => {
    const t = setInterval(() => forceTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const appV = (v && v.versions && v.versions.app) || 'dev';
  const cached = settings.cachedLatestRelease;
  const lastMs = settings.lastUpdateCheckMs;
  const dismissed = settings.dismissedUpdateVersion;

  const checking = updater.status === 'checking';
  const downloading = updater.status === 'downloading';

  return (
    <Section title="Updates">
      <Row label="Check for updates" hint="Powered by GitHub Releases">
        <select
          className="select"
          value={settings.checkForUpdates || 'on-startup'}
          onChange={(e) => set({ checkForUpdates: e.target.value })}
        >
          <option value="on-startup">Automatically on startup (once per day)</option>
          <option value="manual">Only when I click "Check now"</option>
          <option value="never">Never</option>
        </select>
      </Row>

      {/* Compact status card — always visible so the user can see the state
          of their last check at a glance. */}
      <div className="rounded-xl border border-ink-500/40 bg-ink-700/30 p-4">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <div className="text-muted uppercase tracking-widest text-[10px] mb-1">Current</div>
            <div className="text-sm font-semibold text-ink-100 font-mono">v{appV}</div>
          </div>
          <div>
            <div className="text-muted uppercase tracking-widest text-[10px] mb-1">Latest known</div>
            <div className="text-sm font-semibold text-ink-100 font-mono">
              {cached && cached.latest ? `v${cached.latest}` : <span className="text-muted">—</span>}
            </div>
          </div>
          <div className="col-span-2">
            <div className="text-muted uppercase tracking-widest text-[10px] mb-1">Last checked</div>
            <div className="text-sm text-ink-100">{relativeTime(lastMs)}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => checkForUpdates({ force: true })}
            disabled={checking || downloading}
            className="btn-primary text-xs"
          >
            {checking ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin"/> Checking…</>
            ) : (
              <><RefreshCw className="w-3.5 h-3.5"/> Check now</>
            )}
          </button>
          {cached && cached.releaseUrl && (
            <button
              onClick={() => v && v.updater && v.updater.openReleaseUrl(cached.releaseUrl)}
              className="btn-outline text-xs"
              title="Open the latest release page on GitHub"
            >
              <Github className="w-3.5 h-3.5"/> Release notes
            </button>
          )}
          {dismissed && (
            <button
              onClick={() => set({ dismissedUpdateVersion: null })}
              className="btn-ghost text-xs"
              title={`Re-enable notifications for v${dismissed}`}
            >
              Un-skip v{dismissed}
            </button>
          )}
        </div>

        {/* Inline result — this is the fix for "Check Now is not giving a message".
            Whatever the global updater status is, we mirror it here as a small,
            contextual notification so the user always sees what happened. */}
        <InlineCheckResult
          status={updater.status}
          info={updater.info}
          error={updater.error}
          progress={updater.progress}
          installerPath={updater.installerPath}
          onDownload={downloadUpdate}
          onInstall={installUpdate}
          onSkip={dismissUpdate}
        />
      </div>
    </Section>
  );
}

function InlineCheckResult({ status, info, error, progress, installerPath, onDownload, onInstall, onSkip }) {
  if (status === 'idle') return null;
  // "checking" is reflected on the button itself; no extra row needed.
  if (status === 'checking') return null;

  const baseCls = 'mt-3 text-xs px-3 py-2 rounded-lg flex items-center gap-2';

  if (status === 'no-update') {
    return (
      <div className={`${baseCls} bg-emerald-600/10 border border-emerald-500/30 text-emerald-300`}>
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0"/>
        <span>You're on the latest version{info && info.latest ? <> — <b>v{info.latest}</b></> : null}.</span>
      </div>
    );
  }

  if (status === 'available') {
    const latest = info && info.latest;
    const sizeMb = info && info.asset && info.asset.size ? (info.asset.size / 1024 / 1024).toFixed(1) : null;
    return (
      <div className={`${baseCls} bg-veloxa-600/10 border border-veloxa-500/30 text-veloxa-300 flex-wrap`}>
        <Download className="w-3.5 h-3.5 shrink-0"/>
        <span className="flex-1">
          <b>v{latest}</b> is available{sizeMb ? <> · {sizeMb} MB</> : null} — see the banner on the Dashboard or download right here:
        </span>
        <button onClick={onDownload} className="btn-primary text-[11px]" disabled={!info || !info.asset}>
          Download
        </button>
        <button onClick={onSkip} className="btn-ghost text-[11px]">
          Skip
        </button>
      </div>
    );
  }

  if (status === 'downloading') {
    const pct = progress ? Math.round((progress.percent || 0) * 100) : 0;
    return (
      <div className={`${baseCls} bg-veloxa-600/10 border border-veloxa-500/30 text-veloxa-300`}>
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin"/>
        <span className="flex-1">Downloading{info && info.latest ? <> v{info.latest}</> : null}…</span>
        <span className="font-mono">{pct}%</span>
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div className={`${baseCls} bg-emerald-600/10 border border-emerald-500/30 text-emerald-300 flex-wrap`}>
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0"/>
        <span className="flex-1">Downloaded — ready to install.</span>
        <button onClick={onInstall} className="btn-primary text-[11px]">Install now</button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`${baseCls} bg-rose-600/10 border border-rose-500/30 text-rose-300`}>
        <AlertTriangle className="w-3.5 h-3.5 shrink-0"/>
        <span>Couldn't check for updates: {error || 'unknown error'}</span>
      </div>
    );
  }

  return null;
}

function Section({ title, children }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">{title}</h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, hint, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm font-medium text-ink-100">{label}</label>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors ${checked ? 'bg-veloxa-600' : 'bg-ink-600'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`}/>
    </button>
  );
}
