import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { FolderOpen, Trash2, ShieldCheck } from 'lucide-react';
import { bytes as fmtBytes } from '../utils/format';

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
      <h2 className="text-base font-semibold mb-1">Settings</h2>
      <p className="text-xs text-muted mb-6">All settings are saved locally and apply to every run.</p>

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
          hint="If a DOCX or PPTX already has a Veloxa watermark, mark it Skipped instead of doubling up"
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

function UpdatesSection({ settings, set }) {
  const { checkForUpdates, updater } = useStore();
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
      <Row label="Current version">
        <div className="text-sm text-muted">
          {(window.veloxa && window.veloxa.versions && window.veloxa.versions.app) || 'unknown'}
        </div>
      </Row>
      <Row label="Latest checked">
        <div className="text-sm text-muted">
          {settings.lastUpdateCheckMs
            ? new Date(settings.lastUpdateCheckMs).toLocaleString()
            : 'Never'}
          {settings.cachedLatestRelease && settings.cachedLatestRelease.latest
            ? <> · Latest: <b className="text-ink-100">v{settings.cachedLatestRelease.latest}</b></>
            : null}
        </div>
      </Row>
      <button
        onClick={() => checkForUpdates({ force: true })}
        disabled={updater.status === 'checking' || updater.status === 'downloading'}
        className="btn-outline text-xs"
      >
        {updater.status === 'checking' ? 'Checking…' : 'Check now'}
      </button>
      {settings.dismissedUpdateVersion && (
        <button
          onClick={() => set({ dismissedUpdateVersion: null })}
          className="btn-ghost text-xs ml-2"
          title={`Re-show notifications for v${settings.dismissedUpdateVersion}`}
        >
          Un-skip v{settings.dismissedUpdateVersion}
        </button>
      )}
    </Section>
  );
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
