import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, FileText, FileType2, Presentation, FolderInput, Files,
} from 'lucide-react';
import { useStore } from '../store/useStore';

const TYPE_META = {
  '.pdf':  { label: 'PDF',  icon: FileText },
  '.docx': { label: 'DOCX', icon: FileType2 },
  '.pptx': { label: 'PPTX', icon: Presentation },
};

/**
 * Shown after a folder is scanned, so the user can pick which file types to
 * import (or import all). Driven by store.pendingFolderImport — close via
 * Cancel, X, Esc, or by confirming the selection.
 */
export default function FolderImportModal() {
  const pendingFolderImport = useStore((s) => s.pendingFolderImport);
  const hideFolderImport = useStore((s) => s.hideFolderImport);
  const addPendingFiles = useStore((s) => s.addPendingFiles);

  const open = !!pendingFolderImport;
  const byType = pendingFolderImport?.byType || { '.pdf': [], '.docx': [], '.pptx': [] };
  const totalFound = pendingFolderImport?.files?.length || 0;

  // Default: every type with at least one file is enabled.
  const [enabled, setEnabled] = useState({});
  useEffect(() => {
    if (!open) return;
    setEnabled({
      '.pdf':  byType['.pdf'].length  > 0,
      '.docx': byType['.docx'].length > 0,
      '.pptx': byType['.pptx'].length > 0,
    });
  }, [open, pendingFolderImport]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); hideFolderImport(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hideFolderImport]);

  const selected = useMemo(() => {
    if (!open) return [];
    return [
      ...(enabled['.pdf']  ? byType['.pdf']  : []),
      ...(enabled['.docx'] ? byType['.docx'] : []),
      ...(enabled['.pptx'] ? byType['.pptx'] : []),
    ];
  }, [open, enabled, byType]);

  const confirm = () => {
    if (selected.length > 0) addPendingFiles(selected);
    hideFolderImport();
  };

  const importAll = () => {
    addPendingFiles(pendingFolderImport.files);
    hideFolderImport();
  };

  const importOnly = (ext) => {
    addPendingFiles(byType[ext]);
    hideFolderImport();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="folder-import-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={hideFolderImport}
        >
          <motion.div
            initial={{ scale: 0.96, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="surface-1 rounded-2xl w-full max-w-md overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600/40">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-veloxa-400"/>
                Import from folder
              </h2>
              <button onClick={hideFolderImport} className="btn-ghost p-1.5">
                <X className="w-4 h-4"/>
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {totalFound === 0 ? (
                <div className="text-sm text-muted text-center py-4">
                  No supported files (PDF / DOCX / PPTX) found in that folder.
                </div>
              ) : (
                <>
                  <div className="text-xs text-muted">
                    Found <span className="text-ink-100 font-semibold">{totalFound}</span>{' '}
                    supported file{totalFound === 1 ? '' : 's'}. Choose what to import:
                  </div>

                  {/* Quick-pick buttons */}
                  <div className="grid grid-cols-2 gap-2">
                    <QuickButton
                      icon={Files}
                      label="Import all"
                      count={totalFound}
                      onClick={importAll}
                      primary
                    />
                    {Object.entries(TYPE_META).map(([ext, meta]) => {
                      const count = byType[ext].length;
                      if (count === 0) return null;
                      const Icon = meta.icon;
                      return (
                        <QuickButton
                          key={ext}
                          icon={Icon}
                          label={`${meta.label} only`}
                          count={count}
                          onClick={() => importOnly(ext)}
                        />
                      );
                    })}
                  </div>

                  {/* OR custom mix via toggles */}
                  <div className="pt-2 border-t border-ink-600/40">
                    <div className="text-[10px] uppercase tracking-widest text-muted mb-2">
                      Or pick a custom mix
                    </div>
                    <div className="space-y-1">
                      {Object.entries(TYPE_META).map(([ext, meta]) => {
                        const count = byType[ext].length;
                        const Icon = meta.icon;
                        return (
                          <label
                            key={ext}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg surface-2 ${
                              count === 0 ? 'opacity-40' : 'cursor-pointer hover:bg-white/5'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={!!enabled[ext]}
                              disabled={count === 0}
                              onChange={(e) => setEnabled((s) => ({ ...s, [ext]: e.target.checked }))}
                              className="w-3.5 h-3.5 accent-veloxa-500"
                            />
                            <Icon className="w-4 h-4 text-veloxa-400"/>
                            <span className="text-sm text-ink-100 flex-1">{meta.label}</span>
                            <span className="text-xs tabular-nums text-muted">
                              {count} {count === 1 ? 'file' : 'files'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-3 border-t border-ink-600/40 flex items-center justify-end gap-2">
              <button onClick={hideFolderImport} className="btn-ghost">Cancel</button>
              {totalFound > 0 && (
                <button
                  onClick={confirm}
                  disabled={selected.length === 0}
                  className={`btn-primary ${selected.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  Import {selected.length} selected
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function QuickButton({ icon: Icon, label, count, onClick, primary = false }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all ${
        primary
          ? 'gradient-veloxa border-transparent text-white shadow-glow'
          : 'border-ink-500/50 hover:border-veloxa-500 hover:bg-veloxa-600/10 text-ink-100'
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0"/>
      <span className="truncate">{label}</span>
      <span className={`ml-auto tabular-nums shrink-0 ${primary ? 'text-white/90' : 'text-muted'}`}>
        {count}
      </span>
    </button>
  );
}
