import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store/useStore';
import {
  FolderOpen, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Download,
  ExternalLink, Loader2, Github, Info, Cpu, MemoryStick, Sparkles,
  Search, Database, Bell, ShieldCheck, FileText,
  Sun, Moon, Copy, Upload, RotateCcw,
} from 'lucide-react';
import { bytes as fmtBytes, relativeTime } from '../utils/format';

/**
 * Settings — redesigned for v2.6.2.
 *
 * Layout: sticky left rail with section icons + scroll-spy highlight, main
 * column with a search filter, section headers with quick anchors, and a
 * sticky "App version + danger zone" header. New sections expose storage
 * stats, the data-dir paths, and reset / export / import settings affordances.
 */
const SECTIONS = [
  { id: 'output',      title: 'Output',             icon: FolderOpen, keywords: 'output folder naming template counter padding' },
  { id: 'performance', title: 'Performance',        icon: Cpu,        keywords: 'performance concurrent jobs cpu ram memory' },
  { id: 'pdf',         title: 'PDF export',         icon: FileText,   keywords: 'pdf compression convert microsoft office libreoffice' },
  { id: 'conflict',    title: 'Conflict detection', icon: ShieldCheck,keywords: 'conflict already watermarked skip detection' },
  { id: 'storage',     title: 'Storage',            icon: Database,   keywords: 'storage logos orphan cleanup data size' },
  { id: 'application', title: 'Application',        icon: Bell,       keywords: 'application notifications taskbar theme dark light' },
  { id: 'updates',     title: 'Updates',            icon: Download,   keywords: 'update auto check github release version' },
  { id: 'about',       title: 'Data & About',       icon: Info,       keywords: 'paths data dir reset export import about' },
];

export default function SettingsPanel() {
  const { settings, updateSettings, loadSettings } = useStore();
  const v = window.veloxa;
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState('output');
  const sectionRefs = useRef({});
  if (!settings) return null;

  const set = (patch) => updateSettings(patch);

  // Scroll-spy: highlight whichever section is most visible. Updates on
  // every IntersectionObserver tick — debounced naturally by the observer.
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      // Pick the entry with the highest intersection ratio that's currently visible.
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (visible[0]) setActiveSection(visible[0].target.id);
    }, { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] });
    for (const s of SECTIONS) {
      const el = sectionRefs.current[s.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [query]); // re-bind when sections come/go due to search

  const jumpTo = (id) => {
    const el = sectionRefs.current[id];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Filter sections by search query — case-insensitive, matches title or
  // pre-baked keyword list per section.
  const q = query.trim().toLowerCase();
  const visibleSections = q
    ? SECTIONS.filter((s) => s.title.toLowerCase().includes(q) || s.keywords.includes(q))
    : SECTIONS;
  const isVisible = (id) => visibleSections.some((s) => s.id === id);

  return (
    <div className="h-full flex gap-3 lg:gap-5">
      {/* ── Left rail nav — icons-only when < lg, labels at lg+ ───── */}
      <aside className="w-12 lg:w-52 shrink-0 self-start sticky top-0 transition-[width] duration-150">
        <div className="surface-1 rounded-2xl p-1.5 lg:p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted mb-2 px-2 hidden lg:block">Sections</div>
          <nav className="space-y-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = activeSection === s.id;
              const dimmed = q && !isVisible(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => jumpTo(s.id)}
                  title={s.title}
                  className={`w-full text-left flex items-center justify-center lg:justify-start gap-2 px-2 py-2 lg:py-1.5 rounded-lg text-xs transition-colors ${
                    active
                      ? 'bg-veloxa-600/20 text-veloxa-200 font-semibold'
                      : dimmed
                        ? 'text-muted/50'
                        : 'text-ink-100 hover:bg-ink-700/40'
                  }`}
                  disabled={dimmed}
                >
                  <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-veloxa-300' : 'text-muted'}`}/>
                  <span className="truncate hidden lg:inline">{s.title}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* ── Main column ──────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 surface-1 rounded-2xl p-4 lg:p-6 overflow-y-auto">
        {/* Sticky header: title · search · version · global actions */}
        <div className="sticky top-0 z-10 -mx-6 -mt-6 px-6 pt-6 pb-4 mb-2 bg-ink-900/95 backdrop-blur supports-[backdrop-filter]:bg-ink-900/80 border-b border-ink-600/30">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-semibold mb-0.5">Settings</h2>
              <p className="text-[11px] text-muted">All settings are saved locally and apply to every run.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <GlobalActions/>
              <AppVersionBadge/>
            </div>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2"/>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search settings…"
              className="input pl-8 pr-3 py-1.5 text-xs w-full"
            />
          </div>
        </div>

        {/* Sections — each gets an id + ref so the nav can scroll/highlight */}
        {visibleSections.find((s) => s.id === 'output') && (
          <Section ref={(el) => { sectionRefs.current.output = el; }} id="output" title="Output" icon={FolderOpen}>
            <OutputSection settings={settings} set={set} v={v}/>
          </Section>
        )}

        {visibleSections.find((s) => s.id === 'performance') && (
          <Section ref={(el) => { sectionRefs.current.performance = el; }} id="performance" title="Performance" icon={Cpu}>
            <PerformanceBody settings={settings} set={set}/>
          </Section>
        )}

        {visibleSections.find((s) => s.id === 'pdf') && (
          <Section ref={(el) => { sectionRefs.current.pdf = el; }} id="pdf" title="PDF export" icon={FileText}>
            <PdfSection settings={settings} set={set}/>
          </Section>
        )}

        {visibleSections.find((s) => s.id === 'conflict') && (
          <Section ref={(el) => { sectionRefs.current.conflict = el; }} id="conflict" title="Conflict detection" icon={ShieldCheck}>
            <Row label="Skip already-watermarked files"
                 hint="If a file already has a Veloxa watermark, mark it Skipped instead of doubling up">
              <Toggle checked={settings.skipAlreadyWatermarked !== false}
                      onChange={(val) => set({ skipAlreadyWatermarked: val })}/>
            </Row>
          </Section>
        )}

        {visibleSections.find((s) => s.id === 'storage') && (
          <Section ref={(el) => { sectionRefs.current.storage = el; }} id="storage" title="Storage" icon={Database}>
            <StorageSection/>
          </Section>
        )}

        {visibleSections.find((s) => s.id === 'application') && (
          <Section ref={(el) => { sectionRefs.current.application = el; }} id="application" title="Application" icon={Bell}>
            <ApplicationSection settings={settings} set={set}/>
          </Section>
        )}

        {visibleSections.find((s) => s.id === 'updates') && (
          <Section ref={(el) => { sectionRefs.current.updates = el; }} id="updates" title="Updates" icon={Download}>
            <UpdatesSection settings={settings} set={set}/>
          </Section>
        )}

        {visibleSections.find((s) => s.id === 'about') && (
          <Section ref={(el) => { sectionRefs.current.about = el; }} id="about" title="Data & About" icon={Info}>
            <AboutSection/>
          </Section>
        )}

        {visibleSections.length === 0 && (
          <div className="text-center py-10 text-sm text-muted">
            No settings match "{query}".
            <button onClick={() => setQuery('')} className="ml-2 text-veloxa-300 underline">Clear search</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sticky header right-side buttons: export/import/reset live here so they're
// always reachable, no scrolling required.
// ──────────────────────────────────────────────────────────────────────────
function GlobalActions() {
  const { settings, loadSettings } = useStore();
  const v = window.veloxa;
  const [busy, setBusy] = useState(null); // 'export' | 'import' | 'reset'
  const [toast, setToast] = useState(null);

  const flash = (msg, kind = 'ok') => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const onExport = async () => {
    if (!v?.app?.exportSettings) return;
    setBusy('export');
    try {
      const r = await v.app.exportSettings();
      if (r?.ok) flash(`Saved to ${r.path.split(/[\\/]/).pop()}`);
      else if (!r?.cancelled) flash(r?.error || 'Export failed', 'err');
    } finally { setBusy(null); }
  };

  const onImport = async () => {
    if (!v?.app?.importSettings) return;
    if (!window.confirm('Import settings from a JSON file?\n\nYour current settings will be overwritten.')) return;
    setBusy('import');
    try {
      const r = await v.app.importSettings();
      if (r?.ok) { await loadSettings(); flash(`Imported from ${r.path.split(/[\\/]/).pop()}`); }
      else if (!r?.cancelled) flash(r?.error || 'Import failed', 'err');
    } finally { setBusy(null); }
  };

  const onReset = async () => {
    if (!v?.app?.resetSettings) return;
    if (!window.confirm('Reset all settings to defaults?\n\nThis CANNOT be undone. Your profiles, logos, and queue history will NOT be touched.')) return;
    setBusy('reset');
    try {
      // Preserve auto-update opt-out + window position so a reset doesn't
      // re-enable surveys-y things the user explicitly turned off.
      const r = await v.app.resetSettings({ keep: ['checkForUpdates', 'windowBounds'] });
      if (r?.ok) { await loadSettings(); flash('Settings reset to defaults'); }
      else flash(r?.error || 'Reset failed', 'err');
    } finally { setBusy(null); }
  };

  return (
    <>
      {toast && (
        <div className={`text-[11px] px-2 py-1 rounded-md whitespace-nowrap ${
          toast.kind === 'ok'
            ? 'bg-emerald-600/15 text-emerald-300 border border-emerald-500/30'
            : 'bg-rose-600/15 text-rose-300 border border-rose-500/30'
        }`}>{toast.msg}</div>
      )}
      <button onClick={onExport} disabled={!!busy} className="btn-ghost text-xs" title="Export settings to JSON">
        {busy === 'export' ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Download className="w-3.5 h-3.5"/>} Export
      </button>
      <button onClick={onImport} disabled={!!busy} className="btn-ghost text-xs" title="Import settings from JSON">
        {busy === 'import' ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>} Import
      </button>
      <button onClick={onReset} disabled={!!busy} className="btn-ghost text-xs text-rose-300 hover:text-rose-200" title="Reset everything to defaults">
        {busy === 'reset' ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RotateCcw className="w-3.5 h-3.5"/>} Reset
      </button>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Per-section bodies
// ──────────────────────────────────────────────────────────────────────────

function OutputSection({ settings, set, v }) {
  const pickCustomDir = async () => {
    const dir = await v?.app.pickFolder();
    if (dir) set({ customOutputDir: dir, outputMode: 'custom' });
  };
  return (
    <>
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
      <Row label="Default naming template" hint="Tokens: {originalname} {counter} {date} {time} {profile} {ext}">
        <input className="input" value={settings.namingTemplate}
               onChange={(e) => set({ namingTemplate: e.target.value })}/>
        <TemplatePreview template={settings.namingTemplate} padding={settings.counterPadding}/>
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
    </>
  );
}

/**
 * Live preview for the naming template — renders what the next file would be
 * named so the user can confirm their template tokens before processing.
 * Uses the same token grammar as engine/naming.js.
 */
function TemplatePreview({ template, padding = 3 }) {
  const preview = useMemo(() => {
    if (!template) return '';
    const pad = (n, w) => String(n).padStart(Math.max(1, w), '0');
    const d = new Date();
    const date = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
    const time = `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
    return template
      .replace(/\{originalname\}/g, 'invoice-2026')
      .replace(/\{counter\}/g, pad(1, padding))
      .replace(/\{date\}/g, date)
      .replace(/\{time\}/g, time)
      .replace(/\{profile\}/g, 'Confidential')
      .replace(/\{ext\}/g, 'pdf');
  }, [template, padding]);
  const knownTokens = ['{originalname}', '{counter}', '{date}', '{time}', '{profile}', '{ext}'];
  const unknown = (template || '').match(/\{[^}]+\}/g)?.filter((t) => !knownTokens.includes(t)) || [];
  return (
    <div className="mt-1.5 space-y-1">
      <div className="text-[10px] uppercase tracking-widest text-muted">Preview</div>
      <div className="font-mono text-xs text-emerald-300 truncate" title={preview}>
        {preview || <span className="text-muted">(empty)</span>}.pdf
      </div>
      {unknown.length > 0 && (
        <div className="text-[10px] text-amber-300 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3"/>
          Unknown token{unknown.length === 1 ? '' : 's'}: {unknown.join(', ')} (will render literally)
        </div>
      )}
    </div>
  );
}

function PerformanceBody({ settings, set }) {
  const [sys, setSys] = useState(null);
  useEffect(() => {
    const v = window.veloxa;
    if (v?.app?.getSystemInfo) v.app.getSystemInfo().then(setSys).catch(() => {});
  }, []);
  const current = settings.maxConcurrent || 4;
  const rec = sys ? sys.recommendedConcurrent : null;
  return (
    <>
      <Row label="Max concurrent jobs" hint="Higher = faster, more memory">
        <div className="flex items-center gap-2">
          <input type="number" className="input flex-1" min={1} max={16} value={current}
                 onChange={(e) => set({ maxConcurrent: Number(e.target.value) })}/>
          {rec != null && rec !== current && (
            <button onClick={() => set({ maxConcurrent: rec })}
                    className="btn-outline text-xs whitespace-nowrap" title={`Set to recommended (${rec})`}>
              <Sparkles className="w-3.5 h-3.5"/> Use {rec}
            </button>
          )}
        </div>
      </Row>
      <div className="rounded-xl border border-ink-500/40 bg-ink-700/30 p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted mb-2">Detected hardware</div>
        <div className="grid grid-cols-3 gap-3">
          <HardwareTile icon={Sparkles} label="Recommended" value={sys ? sys.recommendedConcurrent : '…'} highlight
            hint="leaves 2 cores for the OS/UI, capped at 8 (diminishing returns past that)"/>
          <HardwareTile icon={Cpu} label="CPU" value={sys ? `${sys.cpuCores} cores` : '…'} hint={sys ? sys.cpuModel : ''}/>
          <HardwareTile icon={MemoryStick} label="RAM" value={sys ? `${sys.totalRamGb} GB` : '…'}
            hint={sys ? `${sys.freeRamGb} GB free right now` : ''}/>
        </div>
        {sys && current > sys.cpuCores && (
          <div className="mt-3 text-xs text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5"/>
            You're requesting {current} workers but only have {sys.cpuCores} cores — extras will idle.
          </div>
        )}
      </div>
      <Row label="Memory-friendly mode" hint="Lower memory at the cost of throughput">
        <Toggle checked={!!settings.memoryFriendly} onChange={(v) => set({ memoryFriendly: v })}/>
      </Row>
    </>
  );
}

function PdfSection({ settings, set }) {
  return (
    <>
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
    </>
  );
}

/**
 * Storage section — orphan-logo cleanup PLUS a "what's actually on disk" panel
 * sourced from app:getStorageStats. Useful for users who want to see why
 * their app data dir is N MB and what's in it.
 */
function StorageSection() {
  const v = window.veloxa;
  const [stats, setStats] = useState(null);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);

  const refresh = async () => {
    if (v?.app?.getStorageStats) {
      try { setStats(await v.app.getStorageStats()); } catch {}
    }
  };
  useEffect(() => { refresh(); }, []);

  const runOrphanCleanup = async () => {
    setCleanupRunning(true);
    setCleanupResult(null);
    try {
      const r = await v?.app.cleanupOrphanLogos();
      setCleanupResult(r);
      await refresh();
    } catch (err) {
      setCleanupResult({ ok: false, error: err.message });
    } finally {
      setCleanupRunning(false);
    }
  };

  const totalBytes = stats
    ? (stats.logos.bytes + stats.profiles.bytes + stats.logs.bytes + stats.settings.bytes)
    : 0;

  return (
    <>
      <div className="rounded-xl border border-ink-500/40 bg-ink-700/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] uppercase tracking-widest text-muted">App data usage</div>
          <button onClick={refresh} className="btn-ghost text-[10px]" title="Refresh">
            <RefreshCw className="w-3 h-3"/> Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StorageRow label="Logos" value={stats ? `${stats.logos.count} file${stats.logos.count === 1 ? '' : 's'} · ${fmtBytes(stats.logos.bytes)}` : '…'}/>
          <StorageRow label="Profiles" value={stats ? `${stats.profiles.count} · ${fmtBytes(stats.profiles.bytes)}` : '…'}/>
          <StorageRow label="Logs" value={stats ? fmtBytes(stats.logs.bytes) : '…'}/>
          <StorageRow label="Settings" value={stats ? fmtBytes(stats.settings.bytes) : '…'}/>
        </div>
        <div className="mt-3 pt-3 border-t border-ink-600/40 flex items-center justify-between">
          <div className="text-xs text-muted">Total app data</div>
          <div className="text-sm font-semibold text-ink-100 font-mono">{stats ? fmtBytes(totalBytes) : '…'}</div>
        </div>
      </div>

      <Row label="Clean up orphan logos"
           hint="Delete logo files in data/logos/ that no profile references">
        <button onClick={runOrphanCleanup} disabled={cleanupRunning} className="btn-outline">
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
    </>
  );
}

function StorageRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-ink-700/40 border border-ink-500/30">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-mono text-ink-100 font-semibold">{value}</span>
    </div>
  );
}

function ApplicationSection({ settings, set }) {
  const { theme, setTheme } = useStore();
  return (
    <>
      <Row label="Theme" hint="Light theme has a small WIP">
        <div className="inline-flex rounded-lg border border-ink-500/40 overflow-hidden">
          <button
            onClick={() => setTheme('dark')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
              theme !== 'light' ? 'bg-veloxa-600/25 text-veloxa-200' : 'text-muted hover:text-ink-100'
            }`}
          >
            <Moon className="w-3.5 h-3.5"/> Dark
          </button>
          <button
            onClick={() => setTheme('light')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors ${
              theme === 'light' ? 'bg-veloxa-600/25 text-veloxa-200' : 'text-muted hover:text-ink-100'
            }`}
          >
            <Sun className="w-3.5 h-3.5"/> Light
          </button>
        </div>
      </Row>
      <Row label="Show desktop notifications">
        <Toggle checked={!!settings.enableNotifications} onChange={(v) => set({ enableNotifications: v })}/>
      </Row>
      <Row label="Show progress in taskbar">
        <Toggle checked={!!settings.enableTaskbarProgress} onChange={(v) => set({ enableTaskbarProgress: v })}/>
      </Row>
    </>
  );
}

/**
 * Data & About — read-only-ish section that shows where the app stores its
 * state, lets you copy/open each path, and shows the version + helpful links.
 */
function AboutSection() {
  const v = window.veloxa;
  const [paths, setPaths] = useState(null);
  const [copied, setCopied] = useState(null);
  useEffect(() => {
    if (v?.app?.getDataPaths) v.app.getDataPaths().then(setPaths).catch(() => {});
  }, []);
  const copyPath = async (p, key) => {
    try {
      await navigator.clipboard.writeText(p);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {}
  };
  const PathRow = ({ label, p, k }) => (
    <div className="flex items-center gap-2 py-1.5">
      <div className="text-[10px] uppercase tracking-widest text-muted w-24 shrink-0">{label}</div>
      <code className="flex-1 text-[11px] font-mono text-ink-100 truncate" title={p}>{p}</code>
      <button onClick={() => copyPath(p, k)} className="btn-ghost p-1.5" title="Copy path">
        {copied === k ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300"/> : <Copy className="w-3.5 h-3.5"/>}
      </button>
      <button onClick={() => v?.app?.showInFolder?.(p)} className="btn-ghost p-1.5" title="Reveal in Explorer">
        <ExternalLink className="w-3.5 h-3.5"/>
      </button>
    </div>
  );
  const appV = (v && v.versions && v.versions.app) || 'dev';
  return (
    <>
      <div className="rounded-xl border border-ink-500/40 bg-ink-700/30 p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted mb-2">Data locations</div>
        {paths ? (
          <>
            <PathRow label="Data dir"  p={paths.dataDir}      k="data"/>
            <PathRow label="Profiles"  p={paths.profilesFile} k="prof"/>
            <PathRow label="Settings"  p={paths.settingsFile} k="set"/>
            <PathRow label="Logs"      p={paths.logsFile}     k="logs"/>
            <PathRow label="Logos dir" p={paths.logosDir}     k="logos"/>
          </>
        ) : (
          <div className="text-xs text-muted">Loading…</div>
        )}
      </div>
      <div className="rounded-xl border border-ink-500/40 bg-ink-700/30 p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted mb-2">About</div>
        <div className="text-xs text-ink-100">
          Veloxa Watermark Studio <span className="font-mono text-veloxa-300">v{appV}</span>
        </div>
        <div className="text-[11px] text-muted mt-1">
          Automated bulk watermarking for PDF, DOCX, and PPTX. All processing happens locally — no files leave your device.
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => v?.updater?.openReleaseUrl?.('https://github.com/khurram5509/Veloxa-Watermark-Studio')}
            className="btn-outline text-xs"
          >
            <Github className="w-3.5 h-3.5"/> View on GitHub
          </button>
          <button
            onClick={() => v?.updater?.openReleaseUrl?.('https://github.com/khurram5509/Veloxa-Watermark-Studio/issues')}
            className="btn-ghost text-xs"
          >
            Report an issue
          </button>
        </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Section wrapper with id/ref for the scroll-spy and header icon
// ──────────────────────────────────────────────────────────────────────────
const Section = React.forwardRef(function Section({ id, title, icon: Icon, children }, ref) {
  return (
    <section ref={ref} id={id} className="mb-8 scroll-mt-32">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted mb-3 flex items-center gap-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-veloxa-300"/>}
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
});

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

function AppVersionBadge() {
  const v = typeof window !== 'undefined' ? window.veloxa : null;
  const appV = (v && v.versions && v.versions.app) || 'dev';
  return (
    <span className="px-2 py-1 rounded-full bg-veloxa-600/15 text-veloxa-300 border border-veloxa-500/30 font-mono text-xs">
      v{appV}
    </span>
  );
}

function HardwareTile({ icon: Icon, label, value, hint, highlight }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${
      highlight ? 'border-veloxa-500/40 bg-veloxa-600/10' : 'border-ink-500/40 bg-ink-700/40'
    }`} title={hint || ''}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className={`w-3 h-3 ${highlight ? 'text-veloxa-300' : 'text-muted'}`}/>
        <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
      </div>
      <div className={`text-sm font-semibold ${highlight ? 'text-veloxa-200' : 'text-ink-100'} font-mono`}>{value}</div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Updates section — unchanged from v2.5.3 (inline check-now feedback + tiles)
// ──────────────────────────────────────────────────────────────────────────
function UpdatesSection({ settings, set }) {
  const { checkForUpdates, updater, downloadUpdate, installUpdate, dismissUpdate } = useStore();
  const v = typeof window !== 'undefined' ? window.veloxa : null;
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const appV = (v && v.versions && v.versions.app) || 'dev';
  const cached = (updater.info && updater.info.ok !== false && updater.info.latest)
    ? { latest: updater.info.latest, releaseUrl: updater.info.releaseUrl, asset: updater.info.asset }
    : settings.cachedLatestRelease;
  const lastMs = settings.lastUpdateCheckMs;
  const dismissed = settings.dismissedUpdateVersion;
  const checking = updater.status === 'checking';
  const downloading = updater.status === 'downloading';
  return (
    <>
      <Row label="Check for updates" hint="Powered by GitHub Releases">
        <select className="select" value={settings.checkForUpdates || 'on-startup'}
                onChange={(e) => set({ checkForUpdates: e.target.value })}>
          <option value="on-startup">Automatically on startup (once per day)</option>
          <option value="manual">Only when I click "Check now"</option>
          <option value="never">Never</option>
        </select>
      </Row>
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
          <button onClick={() => checkForUpdates({ force: true })} disabled={checking || downloading} className="btn-primary text-xs">
            {checking ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/> Checking…</>
                      : <><RefreshCw className="w-3.5 h-3.5"/> Check now</>}
          </button>
          {cached && cached.releaseUrl && (
            <button onClick={() => v && v.updater && v.updater.openReleaseUrl(cached.releaseUrl)}
                    className="btn-outline text-xs" title="Open the latest release page on GitHub">
              <Github className="w-3.5 h-3.5"/> Release notes
            </button>
          )}
          {dismissed && (
            <button onClick={() => set({ dismissedUpdateVersion: null })} className="btn-ghost text-xs"
                    title={`Re-enable notifications for v${dismissed}`}>
              Un-skip v{dismissed}
            </button>
          )}
        </div>
        <InlineCheckResult
          status={updater.status} info={updater.info} error={updater.error}
          progress={updater.progress} installerPath={updater.installerPath}
          onDownload={downloadUpdate} onInstall={installUpdate} onSkip={dismissUpdate}/>
      </div>
    </>
  );
}

function InlineCheckResult({ status, info, error, progress, installerPath, onDownload, onInstall, onSkip }) {
  if (status === 'idle') return null;
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
          <b>v{latest}</b> is available{sizeMb ? <> · {sizeMb} MB</> : null} — Download to install, or skip this version.
        </span>
        <button onClick={onDownload} className="btn-primary text-[11px]" disabled={!info || !info.asset}>Download</button>
        <button onClick={onSkip} className="btn-ghost text-[11px]">Skip</button>
      </div>
    );
  }
  if (status === 'downloading') {
    const pct = progress ? Math.round((progress.percent || 0) * 100) : 0;
    const bps = (progress && progress.bytesPerSec) || 0;
    const speedStr = bps > 0 ? `${(bps / 1024 / 1024).toFixed(1)} MB/s` : '';
    return (
      <div className={`${baseCls} bg-veloxa-600/10 border border-veloxa-500/30 text-veloxa-300`}>
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin"/>
        <span className="flex-1">Downloading{info && info.latest ? <> v{info.latest}</> : null}…</span>
        {speedStr && <span className="font-mono text-[10px] text-muted">{speedStr}</span>}
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
