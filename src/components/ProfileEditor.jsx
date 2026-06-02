import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Save, Image as ImageIcon, FileType, Layers, FolderOpen, Eye, Undo2, Redo2, CheckCircle2, AlertCircle, ArrowDownToLine, Library, FileOutput, ExternalLink } from 'lucide-react';
import { useStore } from '../store/useStore';
import LogoLibrary from './LogoLibrary';

const POSITION_PLACEMENT = {
  'top-left':      { items: 'flex-start',  justify: 'flex-start' },
  'top-center':    { items: 'flex-start',  justify: 'center'     },
  'top-right':     { items: 'flex-start',  justify: 'flex-end'   },
  'middle-left':   { items: 'center',      justify: 'flex-start' },
  'middle-right':  { items: 'center',      justify: 'flex-end'   },
  'bottom-left':   { items: 'flex-end',    justify: 'flex-start' },
  'bottom-center': { items: 'flex-end',    justify: 'center'     },
  'bottom-right':  { items: 'flex-end',    justify: 'flex-end'   },
  'center':        { items: 'center',      justify: 'center'     },
  'diagonal':      { items: 'center',      justify: 'center'     },
};

// The 9 cells of the 3×3 position grid, laid out in display order.
const POSITION_GRID = [
  { v: 'top-left',      label: 'Top left' },
  { v: 'top-center',    label: 'Top center' },
  { v: 'top-right',     label: 'Top right' },
  { v: 'middle-left',   label: 'Middle left' },
  { v: 'center',        label: 'Center' },
  { v: 'middle-right',  label: 'Middle right' },
  { v: 'bottom-left',   label: 'Bottom left' },
  { v: 'bottom-center', label: 'Bottom center' },
  { v: 'bottom-right',  label: 'Bottom right' },
];

const FONTS = ['Helvetica', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];

// Live-preview canvas formats. `aspect` = height/width. `wPx` = canvas width
// in CSS pixels. `pageWPt` = real page width in PDF points so we can render
// every dimension (logo size, fontSize, margin, offsets) at the same scale
// the engine will use on the actual output.
const PREVIEW_FORMATS = {
  'a4':              { aspect: 297 / 210,    label: 'A4 portrait',       wPx: 320, pageWPt: 595.28 },
  'letter':          { aspect: 11 / 8.5,     label: 'Letter portrait',   wPx: 320, pageWPt: 612    },
  'a4-landscape':    { aspect: 210 / 297,    label: 'A4 landscape',      wPx: 420, pageWPt: 841.89 },
  'letter-landscape':{ aspect: 8.5 / 11,     label: 'Letter landscape',  wPx: 420, pageWPt: 792    },
  // PowerPoint widescreen 16:9 = 13.333" × 7.5" = 960pt × 540pt
  'slide-16x9':      { aspect: 540 / 960,    label: 'Slide 16:9',        wPx: 460, pageWPt: 960    },
  // PowerPoint 4:3 = 10" × 7.5" = 720pt × 540pt
  'slide-4x3':       { aspect: 540 / 720,    label: 'Slide 4:3',         wPx: 400, pageWPt: 720    },
};

const HISTORY_LIMIT = 50;
function profilesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function ProfileEditor() {
  const { editingProfile, cancelEditingProfile, loadProfiles } = useStore();
  const [draft, setDraft] = useState(null);
  const [originalSnapshot, setOriginalSnapshot] = useState(null);
  const [logoSrc, setLogoSrc] = useState(null);
  const [history, setHistory] = useState([]);   // past states (for undo)
  const [future, setFuture] = useState([]);     // states ahead of current (for redo)
  const [previewFormat, setPreviewFormat] = useState('letter');
  const v = window.veloxa;

  useEffect(() => {
    setDraft(editingProfile);
    setOriginalSnapshot(editingProfile ? JSON.stringify(editingProfile) : null);
    setHistory([]);
    setFuture([]);
  }, [editingProfile]);

  // Resolve where logos live so we can show "Stored in app" badges and
  // detect external paths that need migrating.
  const [logosDir, setLogosDir] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (v?.app?.getLogosDir) {
      v.app.getLogosDir().then((d) => { if (!cancelled) setLogosDir(d || ''); });
    }
    return () => { cancelled = true; };
  }, []);

  // PDF converter availability (LibreOffice on the host machine).
  const [converter, setConverterStatus] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (v?.app?.checkConverter) {
      v.app.checkConverter()
        .then((s) => { if (!cancelled) setConverterStatus(s || { available: false, error: 'No response' }); })
        .catch((err) => {
          if (!cancelled) setConverterStatus({ available: false, error: (err && err.message) || 'Probe failed' });
        });
    } else {
      // Renderer running without preload bridge — show as unavailable.
      setConverterStatus({ available: false, error: 'IPC unavailable' });
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!draft?.logoPath || !v?.app?.readImageDataUrl) {
      setLogoSrc(null);
      return;
    }
    v.app.readImageDataUrl(draft.logoPath).then((url) => {
      if (!cancelled) setLogoSrc(url || null);
    }).catch(() => { if (!cancelled) setLogoSrc(null); });
    return () => { cancelled = true; };
  }, [draft?.logoPath]);

  // Esc / Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (or Cmd-equivalent on Mac)
  useEffect(() => {
    if (!editingProfile) return;
    const onKey = (e) => {
      const meta = e.ctrlKey || e.metaKey;
      const tag = (e.target && e.target.tagName) || '';
      const inEditableField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);

      if (e.key === 'Escape') {
        e.preventDefault();
        requestCloseRef.current?.();
        return;
      }
      if (meta && (e.key === 'z' || e.key === 'Z')) {
        // In a text input, let the browser handle native undo unless Shift is held (redo)
        if (inEditableField && !e.shiftKey) return;
        e.preventDefault();
        if (e.shiftKey) redoRef.current?.();
        else undoRef.current?.();
        return;
      }
      if (meta && (e.key === 'y' || e.key === 'Y')) {
        if (inEditableField) return;
        e.preventDefault();
        redoRef.current?.();
        return;
      }
      // Ctrl+S → Save
      if (meta && (e.key === 's' || e.key === 'S') && !e.shiftKey) {
        e.preventDefault();
        saveRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingProfile]);

  const requestCloseRef = useRef(null);
  const undoRef = useRef(null);
  const redoRef = useRef(null);
  const saveRef = useRef(null);

  // Surface dirty state to main process (for confirm-before-close).
  // Effect must come before any early return.
  const lastDirtyPushed = useRef(false);
  useEffect(() => {
    const dirtyNow = !!(editingProfile && draft && originalSnapshot !== JSON.stringify(draft));
    if (dirtyNow !== lastDirtyPushed.current) {
      lastDirtyPushed.current = dirtyNow;
      window.veloxa?.app?.setEditorDirty?.(dirtyNow);
    }
  });
  // Send a final clean signal when the editor unmounts entirely.
  useEffect(() => () => {
    if (lastDirtyPushed.current) {
      lastDirtyPushed.current = false;
      window.veloxa?.app?.setEditorDirty?.(false);
    }
  }, []);

  if (!editingProfile || !draft) return null;

  const isDirty = originalSnapshot !== JSON.stringify(draft);

  // Push current draft into history before applying a patch.
  // Coalesce consecutive single-field updates (e.g. dragging a slider) — only
  // push to history if the previous snapshot was a different field.
  const update = (patch) => {
    setDraft((d) => {
      // history push
      setHistory((h) => {
        const trimmed = h.slice(-HISTORY_LIMIT + 1);
        const last = trimmed[trimmed.length - 1];
        // If previous patch touched the same single field, skip pushing again.
        const patchKeys = Object.keys(patch);
        if (patchKeys.length === 1 && last && last.__patchKey === patchKeys[0]) {
          return trimmed;
        }
        return [...trimmed, { ...d, __patchKey: patchKeys[0] }];
      });
      setFuture([]); // any new edit invalidates redo stack
      return { ...d, ...patch };
    });
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      // Strip __patchKey before applying
      const { __patchKey: _ignore, ...clean } = prev;
      setFuture((f) => [draft, ...f].slice(0, HISTORY_LIMIT));
      setDraft(clean);
      return h.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const [next, ...rest] = f;
      setHistory((h) => [...h, { ...draft, __patchKey: '__redo__' }].slice(-HISTORY_LIMIT));
      setDraft(next);
      return rest;
    });
  };
  undoRef.current = undo;
  redoRef.current = redo;
  const canUndo = history.length > 0;
  const canRedo = future.length > 0;

  const requestClose = () => {
    if (isDirty) {
      const ok = window.confirm('You have unsaved changes. Discard them?');
      if (!ok) return;
    }
    cancelEditingProfile();
  };
  requestCloseRef.current = requestClose;

  const save = async () => {
    await v?.profiles.save(draft);
    await loadProfiles();
    cancelEditingProfile();
  };
  saveRef.current = save;

  const browseLogo = async () => {
    const p = await v?.app.pickImage();
    if (!p) return;
    // Copy into the app's data dir so the watermark keeps working after the
    // user moves or deletes the source. saveLogoFile dedupes on content hash.
    const saved = (await v?.app.saveLogoFile?.(p)) || p;
    update({ logoPath: saved });
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
        // Backdrop click is intentionally a no-op: this form holds unsaved work.
        // User must click Cancel/X to close (with confirm if dirty).
      >
        <motion.div
          initial={{ scale: 0.96, y: 20, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.96, y: 20, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="surface-1 rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600/40">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              {draft.id ? 'Edit Profile' : 'Create Profile'}
              {isDirty && (
                <span className="chip text-amber-400 bg-amber-600/10 border-amber-500/20" title="Unsaved changes">
                  Unsaved
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={undo}
                disabled={!canUndo}
                className={`btn-ghost p-1.5 ${canUndo ? '' : 'opacity-30 cursor-not-allowed'}`}
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-4 h-4"/>
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                className={`btn-ghost p-1.5 ${canRedo ? '' : 'opacity-30 cursor-not-allowed'}`}
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-4 h-4"/>
              </button>
              <span className="w-px h-5 bg-ink-600/60 mx-1"/>
              <button onClick={requestClose} className="btn-ghost p-1.5" title="Close">
                <X className="w-4 h-4"/>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-5 grid grid-cols-2 gap-5">
            {/* Left: form */}
            <div className="space-y-4">
              <div>
                <div className="label">Name</div>
                <input className="input" value={draft.name}
                       onChange={(e) => update({ name: e.target.value })}/>
              </div>

              <div>
                <div className="label">Watermark type</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: 'text', label: 'Text', icon: FileType },
                    { v: 'image', label: 'Logo', icon: ImageIcon },
                    { v: 'combined', label: 'Combined', icon: Layers },
                  ].map(({ v: val, label, icon: Icon }) => (
                    <button
                      key={val}
                      onClick={() => update({ type: val })}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        draft.type === val
                          ? 'border-veloxa-500 bg-veloxa-600/15 text-white'
                          : 'border-ink-500/50 hover:border-ink-400 text-ink-100'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5"/> {label}
                    </button>
                  ))}
                </div>
              </div>

              {(draft.type === 'text' || draft.type === 'combined') && (
                <>
                  <div>
                    <div className="label">Watermark text</div>
                    <input className="input" value={draft.text}
                           onChange={(e) => update({ text: e.target.value })}/>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="label">Font</div>
                      <select className="select" value={draft.fontFamily}
                              onChange={(e) => update({ fontFamily: e.target.value })}>
                        {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <div className="label">Size</div>
                      <input type="number" className="input" min={8} max={300}
                             value={draft.fontSize}
                             onChange={(e) => update({ fontSize: Number(e.target.value) })}/>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="label">Color</div>
                      <div className="flex items-center gap-2">
                        <input type="color" value={draft.fontColor}
                               onChange={(e) => update({ fontColor: e.target.value })}
                               className="w-10 h-9 rounded-lg border border-ink-500/50 bg-transparent cursor-pointer"/>
                        <input className="input" value={draft.fontColor}
                               onChange={(e) => update({ fontColor: e.target.value })}/>
                      </div>
                    </div>
                    <div>
                      <div className="label">Style</div>
                      <div className="flex gap-2">
                        <button onClick={() => update({ bold: !draft.bold })}
                                className={`px-3 py-2 rounded-lg border text-sm font-bold ${draft.bold ? 'border-veloxa-500 bg-veloxa-600/20' : 'border-ink-500/50'}`}>B</button>
                        <button onClick={() => update({ italic: !draft.italic })}
                                className={`px-3 py-2 rounded-lg border text-sm italic ${draft.italic ? 'border-veloxa-500 bg-veloxa-600/20' : 'border-ink-500/50'}`}>I</button>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {(draft.type === 'image' || draft.type === 'combined') && (
                <LogoInput
                  draft={draft}
                  update={update}
                  logosDir={logosDir}
                  browseLogo={browseLogo}
                  onMigrate={async () => {
                    const saved = await v?.app.saveLogoFile?.(draft.logoPath);
                    if (saved) update({ logoPath: saved });
                  }}
                  onOpenFolder={() => {
                    if (logosDir) v?.app?.openPath?.(logosDir);
                  }}
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="label flex items-center justify-between">
                    <span>Position</span>
                    {/* Diagonal mode is rotation-driven and lives outside the 3×3
                        grid; surface it as a small toggle next to the label. */}
                    <button
                      type="button"
                      onClick={() => {
                        const next = draft.position === 'diagonal' ? 'center' : 'diagonal';
                        if (next === 'diagonal' && (!draft.rotation || draft.rotation === 0)) {
                          update({ position: next, rotation: -30 });
                        } else {
                          update({ position: next });
                        }
                      }}
                      className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full border transition-colors ${
                        draft.position === 'diagonal'
                          ? 'border-veloxa-500/60 bg-veloxa-600/20 text-veloxa-200'
                          : 'border-ink-500/40 text-muted hover:text-ink-100 hover:border-ink-400/50'
                      }`}
                      title="Toggle diagonal mode (center + auto-rotation)"
                    >
                      Diagonal
                    </button>
                  </div>
                  <PositionGrid
                    value={draft.position}
                    onChange={(next) => {
                      // Switching out of diagonal back to a grid cell should not
                      // drag the -30° auto-rotation along; leave rotation as-is
                      // since users often want to keep their chosen angle.
                      update({ position: next });
                    }}
                  />
                </div>
                <div>
                  <div className="label">Margin (pt)</div>
                  <input type="number" className="input" value={draft.margin}
                         onChange={(e) => update({ margin: Number(e.target.value) })}/>
                </div>
              </div>

              <div>
                <div className="label flex items-center justify-between">
                  <span>Offset (pt)</span>
                  <button
                    type="button"
                    className="text-[10px] text-muted hover:text-veloxa-400 normal-case tracking-normal"
                    onClick={() => update({ offsetX: 0, offsetY: 0 })}
                  >
                    Reset to 0,0
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input type="number" className="input" value={draft.offsetX ?? 0}
                           step={1}
                           onChange={(e) => update({ offsetX: Number(e.target.value) })}
                           placeholder="X (right →)" aria-label="X offset"/>
                    <div className="text-[11px] text-muted mt-1">X axis · positive moves right</div>
                  </div>
                  <div>
                    <input type="number" className="input" value={draft.offsetY ?? 0}
                           step={1}
                           onChange={(e) => update({ offsetY: Number(e.target.value) })}
                           placeholder="Y (down ↓)" aria-label="Y offset"/>
                    <div className="text-[11px] text-muted mt-1">Y axis · positive moves down</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="label">Opacity</div>
                  <input type="range" min={0} max={1} step={0.01} value={draft.opacity}
                         onChange={(e) => update({ opacity: Number(e.target.value) })} className="w-full"/>
                  <div className="text-[11px] text-muted text-right tabular-nums">
                    {Math.round(draft.opacity * 100)}%
                  </div>
                </div>
                <div>
                  <div className="label">Rotation</div>
                  <input type="range" min={-180} max={180} step={1} value={draft.rotation}
                         onChange={(e) => update({ rotation: Number(e.target.value) })} className="w-full"/>
                  <div className="text-[11px] text-muted text-right tabular-nums">{draft.rotation}°</div>
                </div>
                <div>
                  <div className="label">Scale</div>
                  <input type="range" min={0.2} max={3} step={0.05} value={draft.scale}
                         onChange={(e) => update({ scale: Number(e.target.value) })} className="w-full"/>
                  <div className="text-[11px] text-muted text-right tabular-nums">×{draft.scale.toFixed(2)}</div>
                </div>
              </div>

              <div>
                <div className="label">Apply to</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { v: 'all', label: 'All pages' },
                    { v: 'first', label: 'First only' },
                    { v: 'last', label: 'Last only' },
                    { v: 'custom', label: 'Custom range' },
                  ].map(({ v: val, label }) => (
                    <button
                      key={val}
                      onClick={() => update({ pages: val })}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-medium ${
                        draft.pages === val ? 'border-veloxa-500 bg-veloxa-600/20 text-white' : 'border-ink-500/50'
                      }`}
                    >{label}</button>
                  ))}
                </div>
                {draft.pages === 'custom' && (
                  <input className="input mt-2" placeholder="e.g. 1-3, 5, 8-10"
                         value={draft.customPages || ''}
                         onChange={(e) => update({ customPages: e.target.value })}/>
                )}
              </div>

              <div>
                <div className="label">Output naming template</div>
                <input className="input" value={draft.namingTemplate}
                       onChange={(e) => update({ namingTemplate: e.target.value })}/>
                <div className="text-[11px] text-muted mt-1">
                  Tokens: <code>{'{originalname}'}</code>, <code>{'{counter}'}</code>, <code>{'{date}'}</code>, <code>{'{time}'}</code>, <code>{'{profile}'}</code>
                </div>
              </div>

              {/* Convert non-PDF outputs to PDF (Microsoft Office or LibreOffice) */}
              <ConvertToPdfToggle
                value={!!draft.convertToPdf}
                onChange={(val) => update({ convertToPdf: val })}
                converter={converter}
                quality={draft.pdfQuality || 'standard'}
                onQualityChange={(q) => update({ pdfQuality: q })}
              />

              <label className="flex items-center gap-2 text-sm text-ink-100">
                <input type="checkbox" checked={!!draft.isDefault}
                       onChange={(e) => update({ isDefault: e.target.checked })}/>
                Use as default profile
              </label>
            </div>

            {/* Right: live preview */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="label flex items-center gap-1.5 mb-0"><Eye className="w-3 h-3"/> Live preview</div>
                <select
                  value={previewFormat}
                  onChange={(e) => setPreviewFormat(e.target.value)}
                  className="select py-1 px-2 text-[11px] w-auto"
                  title="Preview canvas size"
                >
                  {Object.entries(PREVIEW_FORMATS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <LivePreview draft={draft} logoSrc={logoSrc} format={PREVIEW_FORMATS[previewFormat]} />
              <div className="text-[11px] text-muted leading-relaxed">
                Preview reflects type, position, opacity, rotation, scale, color, font, and logo.
                PDFs render with embedded fonts; DOCX/PPTX use a native watermark layer.
              </div>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-ink-600/40 flex items-center justify-end gap-2">
            <button onClick={requestClose} className="btn-ghost">Cancel</button>
            <button onClick={save} className="btn-primary">
              <Save className="w-4 h-4"/> Save profile
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ConvertToPdfToggle({ value, onChange, converter, quality, onQualityChange }) {
  // converter: { available, active, backends:[...], msoffice:{...}, libreoffice:{...} } | null
  const loading = converter === null;
  const available = converter && converter.available;
  const backends = (converter && converter.backends) || [];
  const mo = (converter && converter.msoffice) || {};
  const lo = (converter && converter.libreoffice) || {};

  return (
    <div className={`rounded-xl border px-3 py-2.5 transition-colors ${
      value ? 'border-veloxa-500/50 bg-veloxa-600/5' : 'border-ink-600/40'
    }`}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-veloxa-600/15 text-veloxa-400 border border-veloxa-500/30">
          <FileOutput className="w-4 h-4"/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-sm font-semibold text-ink-100 cursor-pointer">
              Convert output to PDF
            </label>
            {loading ? (
              <span className="chip text-ink-200 bg-ink-700/60 border-ink-500/30 normal-case tracking-normal">
                Checking…
              </span>
            ) : available ? (
              backends.map((b) => (
                <span
                  key={b}
                  className="chip text-emerald-400 bg-emerald-600/10 border-emerald-500/20 normal-case tracking-normal"
                >
                  <CheckCircle2 className="w-3 h-3"/> {b}
                </span>
              ))
            ) : (
              <span className="chip text-amber-400 bg-amber-600/10 border-amber-500/20 normal-case tracking-normal" title={(converter && converter.error) || 'Not detected'}>
                <AlertCircle className="w-3 h-3"/> No converter found
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted mt-1 leading-relaxed">
            {available ? (
              <>
                After watermarking, DOCX/PPTX outputs are converted to PDF (PDF inputs pass through unchanged).
                {(mo.word || mo.powerpoint) && lo.available && (
                  <> Microsoft Office is preferred for fidelity; LibreOffice is the fallback.</>
                )}
                {(mo.word || mo.powerpoint) && !lo.available && (
                  <> Using Microsoft Office (Word/PowerPoint) — no extra install needed.</>
                )}
                {!(mo.word || mo.powerpoint) && lo.available && (
                  <> Using LibreOffice (install Microsoft Office for higher-fidelity output).</>
                )}
              </>
            ) : (
              <>
                Requires <b>Microsoft Office</b> (Word/PowerPoint, Windows) <b>or</b> <b>LibreOffice</b> (cross-platform).{' '}
                <a
                  href="https://www.libreoffice.org/download/download/"
                  className="text-veloxa-400 underline inline-flex items-center gap-1"
                  onClick={(e) => {
                    e.preventDefault();
                    if (window.veloxa?.app?.openExternal) {
                      window.veloxa.app.openExternal('https://www.libreoffice.org/download/download/');
                    }
                  }}
                >
                  Download LibreOffice <ExternalLink className="w-2.5 h-2.5"/>
                </a>
              </>
            )}
          </div>
        </div>
        <button
          onClick={() => onChange(!value)}
          disabled={loading}
          className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${
            value ? 'bg-veloxa-600' : 'bg-ink-600'
          } ${loading ? 'opacity-40 cursor-not-allowed' : ''}`}
          title={value ? 'Disable PDF conversion' : 'Enable PDF conversion'}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
              value ? 'translate-x-4' : ''
            }`}
          />
        </button>
      </div>
      {/* Quality dropdown — only meaningful when conversion is on */}
      {value && (
        <div className="mt-2.5 pt-2.5 border-t border-ink-600/30 space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted shrink-0">Output quality</span>
            <select
              value={quality || 'standard'}
              onChange={(e) => onQualityChange && onQualityChange(e.target.value)}
              className="select py-1 text-xs flex-1 max-w-xs"
            >
              <option value="standard">Standard — smaller files (JPEG q75, 150 DPI)</option>
              <option value="high">High — print quality (lossless, full DPI, larger files)</option>
            </select>
          </div>
          <div className="text-[10px] text-muted leading-relaxed">
            Affects Word and LibreOffice conversions. PowerPoint always renders at its default quality
            (a PowerShell-COM marshalling limitation outside our control).
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 3×3 grid position picker — replaces the old "Position" dropdown.
 *
 * Each cell maps to one of the engine's 9 placement keys (top-left through
 * bottom-right plus center). Clicking a cell selects it and the rest of the
 * editor (live preview + saved profile) updates accordingly. Diagonal is
 * surfaced as a pill toggle next to the label since it's a rotation mode,
 * not a real grid position.
 */
function PositionGrid({ value, onChange }) {
  const isDiagonal = value === 'diagonal';
  return (
    <div className="grid grid-cols-3 gap-1.5 p-1.5 rounded-lg border border-ink-500/40 bg-ink-700/30">
      {POSITION_GRID.map((cell) => {
        const selected = cell.v === value || (cell.v === 'center' && isDiagonal);
        return (
          <button
            key={cell.v}
            type="button"
            onClick={() => onChange(cell.v)}
            title={cell.label}
            aria-label={cell.label}
            aria-pressed={selected}
            className={`group relative aspect-square rounded-md border transition-all ${
              selected
                ? 'border-veloxa-500 bg-veloxa-600/25 shadow-glow'
                : 'border-ink-500/40 hover:border-veloxa-500/60 hover:bg-veloxa-600/10'
            }`}
          >
            <span
              className={`absolute w-1.5 h-1.5 rounded-full ${
                selected ? 'bg-veloxa-300' : 'bg-ink-400/60 group-hover:bg-veloxa-400/80'
              }`}
              style={{
                top:  cell.v.startsWith('top-')    ? '20%' : cell.v.startsWith('bottom-') ? '80%' : '50%',
                left: cell.v.endsWith('-left')     ? '20%' : cell.v.endsWith('-right')   ? '80%' : '50%',
                transform: 'translate(-50%, -50%)',
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

function LogoInput({ draft, update, logosDir, browseLogo, onMigrate, onOpenFolder }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const logoPath = draft.logoPath || '';
  const hasLogo = !!logoPath;
  // Robust check: normalise both sides to forward slashes + lowercase since
  // Windows paths are case-insensitive and may use backslashes.
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const isInApp = hasLogo && logosDir && norm(logoPath).startsWith(norm(logosDir));
  const filename = logoPath ? logoPath.split(/[\\/]/).pop() : '';

  return (
    <div>
      <div className="label flex items-center justify-between">
        <span>Logo image</span>
        {hasLogo && (
          isInApp ? (
            <span className="chip text-emerald-400 bg-emerald-600/10 border-emerald-500/20 normal-case tracking-normal">
              <CheckCircle2 className="w-3 h-3"/> Stored in app
            </span>
          ) : (
            <span className="chip text-amber-400 bg-amber-600/10 border-amber-500/20 normal-case tracking-normal" title="External path — the watermark will break if you move or delete the source file">
              <AlertCircle className="w-3 h-3"/> External path
            </span>
          )
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          className="input flex-1"
          placeholder="No image selected"
          value={hasLogo ? (isInApp ? `data\\logos\\${filename}` : logoPath) : ''}
          readOnly
          title={logoPath}
        />
        <button onClick={browseLogo} className="btn-outline" title="Pick a new logo from disk">
          <FolderOpen className="w-3.5 h-3.5"/> Browse
        </button>
        <button onClick={() => setLibraryOpen(true)} className="btn-outline" title="Reuse a logo from the app's library">
          <Library className="w-3.5 h-3.5"/> Library
        </button>
        {hasLogo && !isInApp && (
          <button
            onClick={onMigrate}
            className="btn-outline text-amber-400 border-amber-500/40"
            title="Copy this logo into the app's data folder so the watermark survives source-file deletion"
          >
            <ArrowDownToLine className="w-3.5 h-3.5"/> Save to app
          </button>
        )}
        {hasLogo && (
          <button
            onClick={() => update({ logoPath: '' })}
            className="btn-ghost p-2"
            title="Clear logo"
          >
            <X className="w-3.5 h-3.5"/>
          </button>
        )}
      </div>
      <LogoLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPick={(p) => update({ logoPath: p })}
      />
      <div className="text-[11px] text-muted mt-1.5 leading-relaxed">
        {isInApp ? (
          <>
            Logo is copied into{' '}
            <button
              onClick={onOpenFolder}
              className="text-veloxa-400 hover:underline"
            >
              %APPDATA%\Veloxa Watermark Studio\data\logos\
            </button>
            {' '}— survives moving / deleting the source file.
          </>
        ) : hasLogo ? (
          <>
            Path is outside the app folder. Click <b>Save to app</b> to copy
            this logo into <Code>%APPDATA%\Veloxa Watermark Studio\data\logos\</Code>
            so the watermark keeps working if you ever move the source.
          </>
        ) : (
          <>Pick a PNG or JPG. We'll copy it into the app's data folder so the watermark always works.</>
        )}
      </div>
    </div>
  );
}

function Code({ children }) {
  return (
    <code className="px-1 py-0.5 rounded bg-ink-700/60 border border-ink-600/40 text-veloxa-300 text-[11px] font-mono">
      {children}
    </code>
  );
}

function LivePreview({ draft, logoSrc, format }) {
  const place = POSITION_PLACEMENT[draft.position] || POSITION_PLACEMENT.center;
  const showText = (draft.type === 'text' || draft.type === 'combined') && !!draft.text;
  const showLogo = (draft.type === 'image' || draft.type === 'combined') && !!logoSrc;

  // Real page dimensions in points → CSS px scale factor for this canvas.
  // Everything the engine measures in points (fontSize, margin, offsetX/Y,
  // logo size) gets multiplied by pxPerPt so the preview matches the output.
  const fmt = format || PREVIEW_FORMATS.letter;
  const canvasWpx = fmt.wPx;
  const canvasHpx = fmt.wPx * fmt.aspect;
  const pageWpt = fmt.pageWPt;
  const pageHpt = pageWpt * fmt.aspect;
  const pxPerPt = canvasWpx / pageWpt;

  const marginPx = Math.max(0, draft.margin ?? 36) * pxPerPt;
  const offsetXpx = (draft.offsetX || 0) * pxPerPt;
  const offsetYpx = (draft.offsetY || 0) * pxPerPt;
  const fontSizePx = (draft.fontSize || 60) * pxPerPt;
  // Engine sizes the logo to 35% of the page's smaller dimension × scale,
  // preserving aspect ratio. Mirror that here.
  const logoMaxPx = Math.min(pageWpt, pageHpt) * 0.35 * (draft.scale || 1) * pxPerPt;

  return (
    <div
      className="bg-white rounded-xl border border-ink-500/30 overflow-hidden relative mx-auto"
      style={{
        width: '100%',
        maxWidth: `${canvasWpx}px`,
        aspectRatio: `${1} / ${fmt.aspect}`,
      }}
    >
      {/* Faux page chrome */}
      <div className="absolute inset-x-0 top-0 h-7 border-b border-slate-200 bg-slate-50/80 flex items-center px-3 text-[10px] text-slate-400">
        {fmt.label} · {Math.round(pageWpt)}×{Math.round(pageHpt)} pt
      </div>
      <div className="absolute inset-x-6 top-10 space-y-1.5 pointer-events-none">
        <div className="h-2 w-1/3 rounded bg-slate-200/80"/>
        <div className="h-1.5 w-full rounded bg-slate-100"/>
        <div className="h-1.5 w-11/12 rounded bg-slate-100"/>
        <div className="h-1.5 w-10/12 rounded bg-slate-100"/>
        <div className="h-1.5 w-9/12 rounded bg-slate-100"/>
      </div>

      {/* Watermark layer — anchored via flex with margin = real edge inset */}
      <div
        className="absolute inset-0 flex"
        style={{
          alignItems: place.items,
          justifyContent: place.justify,
          padding: `${marginPx}px`,
        }}
      >
        {/* Inner positioning block — overlays text on top of logo to match the
            engine which paints them at the same anchor point. */}
        <div
          className="relative inline-block"
          style={{
            transform: `translate(${offsetXpx}px, ${offsetYpx}px) rotate(${draft.rotation || 0}deg)`,
            transformOrigin: 'center',
            opacity: Math.max(0, Math.min(1, draft.opacity ?? 1)),
          }}
        >
          {showLogo && (
            <img
              src={logoSrc}
              alt=""
              draggable={false}
              style={{
                width: `${logoMaxPx}px`,
                height: 'auto',
                maxWidth: 'none',   // override Tailwind preflight
                objectFit: 'contain',
                display: 'block',
              }}
            />
          )}
          {showText && (
            <div
              style={{
                position: showLogo ? 'absolute' : 'static',
                inset: showLogo ? 0 : undefined,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: draft.fontColor,
                fontFamily: draft.fontFamily,
                fontSize: `${fontSizePx}px`,
                fontWeight: draft.bold ? 800 : 400,
                fontStyle: draft.italic ? 'italic' : 'normal',
                whiteSpace: 'nowrap',
                lineHeight: 1,
                pointerEvents: 'none',
              }}
            >
              {draft.text}
            </div>
          )}
          {!showLogo && !showText && (
            <div className="text-slate-300 text-xs italic">Empty watermark</div>
          )}
        </div>
      </div>
    </div>
  );
}
