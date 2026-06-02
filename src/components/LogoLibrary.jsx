import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Image as ImageIcon, Trash2, Library } from 'lucide-react';
import { bytes as fmtBytes } from '../utils/format';

/**
 * Library picker — shows every logo currently in the app's data/logos folder
 * as a thumbnail grid. Click to use, X to delete (with confirm). Used to reuse
 * logos across profiles without re-picking from disk.
 */
export default function LogoLibrary({ open, onClose, onPick }) {
  const [logos, setLogos] = useState([]);
  const [previews, setPreviews] = useState({});
  const [loading, setLoading] = useState(false);
  const v = window.veloxa;

  useEffect(() => {
    if (!open || !v?.app?.listLogos) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const list = await v.app.listLogos();
      if (cancelled) return;
      setLogos(list || []);
      setLoading(false);
      // Lazy-load previews
      for (const l of (list || [])) {
        v.app.readImageDataUrl(l.path).then((url) => {
          if (cancelled) return;
          setPreviews((prev) => ({ ...prev, [l.path]: url || null }));
        }).catch(() => {});
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleDelete = async (logoPath) => {
    if (!window.confirm('Delete this logo from the app library? Profiles still using it will fail.')) return;
    await v?.app.deleteLogo(logoPath);
    setLogos((cur) => cur.filter((l) => l.path !== logoPath));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="logo-library-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="surface-1 rounded-2xl w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600/40">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Library className="w-4 h-4 text-veloxa-400"/>
                Logo library
                <span className="chip text-ink-200 bg-ink-700/60 border-ink-500/30 normal-case tracking-normal">
                  {logos.length} {logos.length === 1 ? 'logo' : 'logos'}
                </span>
              </h2>
              <button onClick={onClose} className="btn-ghost p-1.5">
                <X className="w-4 h-4"/>
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {loading ? (
                <div className="text-center text-muted text-sm py-8">Loading…</div>
              ) : logos.length === 0 ? (
                <div className="text-center py-12 space-y-2">
                  <ImageIcon className="w-10 h-10 text-muted mx-auto opacity-40"/>
                  <div className="text-sm text-ink-100">No saved logos yet</div>
                  <div className="text-xs text-muted">
                    Pick a logo via Browse — it'll be copied here automatically and you can reuse it from this library.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {logos.map((logo) => (
                    <div
                      key={logo.path}
                      className="group relative rounded-xl border border-ink-600/40 hover:border-veloxa-500/60 hover:bg-veloxa-600/5 transition-all overflow-hidden"
                    >
                      <button
                        onClick={() => { onPick(logo.path); onClose(); }}
                        className="w-full aspect-square bg-white flex items-center justify-center"
                        title={logo.filename}
                      >
                        {previews[logo.path] ? (
                          <img
                            src={previews[logo.path]}
                            alt=""
                            className="max-w-full max-h-full object-contain"
                            draggable={false}
                          />
                        ) : (
                          <ImageIcon className="w-8 h-8 text-slate-300"/>
                        )}
                      </button>
                      <div className="px-2 py-1.5 text-[11px] flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-ink-100" title={logo.filename}>
                          {logo.filename}
                        </span>
                        <span className="text-muted shrink-0 tabular-nums">
                          {fmtBytes(logo.size)}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDelete(logo.path)}
                        className="absolute top-1.5 right-1.5 p-1.5 rounded bg-black/70 hover:bg-rose-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Delete this logo from the library"
                      >
                        <Trash2 className="w-3 h-3"/>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="px-5 py-2.5 border-t border-ink-600/40 text-[11px] text-muted">
              Logos are stored in <code className="text-veloxa-300">%APPDATA%\Veloxa Watermark Studio\data\logos\</code> and de-duped by content hash.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
