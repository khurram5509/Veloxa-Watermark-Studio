import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { UploadCloud, FolderOpen, FilePlus2, Trash2, FileText, Presentation, FileType2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { basename, ext } from '../utils/format';

// Helper: is any modal currently obscuring the workspace?
const isModalOpen = () => {
  const s = useStore.getState();
  return !!s.editingProfile || !!s.helpOpen || !!s.pendingFolderImport;
};

const ICONS = {
  '.pdf': FileText,
  '.docx': FileType2,
  '.pptx': Presentation,
};

export default function DropZone() {
  const {
    pendingFiles, setPendingFiles, addPendingFiles, clearPendingFiles,
    showFolderImport,
  } = useStore();
  const [active, setActive] = useState(false);
  const dragDepth = useRef(0);
  const v = window.veloxa;

  // Scan a list of input paths. If any path was a folder, show the type-filter
  // picker so the user can choose what to import. Explicit file selections
  // skip the picker and add directly.
  const expandPaths = useCallback(async (paths) => {
    if (!v) {
      addPendingFiles(paths);
      return;
    }
    const scan = await v.scan.paths(paths);
    if (!scan || !scan.files || scan.files.length === 0) {
      // Nothing supported. If a folder was scanned, surface the empty result
      // via the modal so user gets explicit feedback.
      if (scan?.hadFolder) showFolderImport(scan);
      return;
    }
    if (scan.hadFolder) {
      showFolderImport(scan);
    } else {
      addPendingFiles(scan.files);
    }
  }, [addPendingFiles, showFolderImport]);

  useEffect(() => {
    const onDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setActive(false);
      // Don't ingest files while ProfileEditor or HelpModal is open — would
      // otherwise silently steal focus from the modal and confuse the user.
      if (isModalOpen()) return;
      const files = Array.from(e.dataTransfer.files || []);
      const paths = files
        .map((f) => (v?.getPathForFile ? v.getPathForFile(f) : f.path))
        .filter(Boolean);
      if (paths.length) await expandPaths(paths);
    };
    const onOver = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onEnter = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (isModalOpen()) return;
      dragDepth.current += 1;
      setActive(true);
    };
    const onLeave = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (isModalOpen()) return;
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) { dragDepth.current = 0; setActive(false); }
    };

    window.addEventListener('drop', onDrop);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
    };
  }, [expandPaths]);

  // Listen for files imported via second-instance / file association
  useEffect(() => {
    if (!v) return;
    const off = v.on.filesImported((paths) => expandPaths(paths));
    return off;
  }, [expandPaths]);

  const browseFiles = async () => {
    const picked = await v?.app.pickFiles();
    if (picked?.length) await expandPaths(picked);
  };
  const browseFolder = async () => {
    const dir = await v?.app.pickFolder();
    if (dir) await expandPaths([dir]);
  };

  const removeFile = (idx) => {
    const next = pendingFiles.slice();
    next.splice(idx, 1);
    setPendingFiles(next);
  };

  return (
    <div className="surface-1 rounded-2xl p-5 flex flex-col gap-4">
      <div
        className={`drop-zone relative rounded-xl border-2 border-dashed border-ink-500/50 bg-ink-700/20 transition-all duration-200 ${active ? 'drop-active' : ''}`}
      >
        <motion.div
          initial={false}
          animate={{ scale: active ? 1.01 : 1 }}
          className="px-8 py-12 flex flex-col items-center text-center gap-3"
        >
          <div className="w-14 h-14 rounded-2xl gradient-veloxa flex items-center justify-center shadow-glow">
            <UploadCloud className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="text-base font-semibold text-ink-100">
              Drag & drop files or folders here
            </div>
            <div className="text-xs text-muted mt-1">
              Bulk-process PDF, DOCX, and PPTX. Folders are scanned recursively.
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={browseFiles} className="btn-outline">
              <FilePlus2 className="w-4 h-4" /> Add files
            </button>
            <button onClick={browseFolder} className="btn-outline">
              <FolderOpen className="w-4 h-4" /> Add folder
            </button>
          </div>
        </motion.div>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted">
          {pendingFiles.length === 0
            ? 'No files staged. Drop files above to begin.'
            : `${pendingFiles.length} file${pendingFiles.length === 1 ? '' : 's'} staged.`}
        </div>
        {pendingFiles.length > 0 && (
          <button onClick={clearPendingFiles} className="btn-ghost text-xs">
            <Trash2 className="w-3.5 h-3.5" /> Clear all
          </button>
        )}
      </div>

      {pendingFiles.length > 0 && (
        <div className="max-h-56 overflow-auto pr-1 space-y-1.5">
          {pendingFiles.map((f, i) => {
            const Icon = ICONS[ext(f)] || FileText;
            return (
              <motion.div
                key={f + i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg surface-2"
              >
                <Icon className="w-4 h-4 text-veloxa-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-ink-100 truncate">{basename(f)}</div>
                  <div className="text-[10px] text-muted truncate">{f}</div>
                </div>
                <button onClick={() => removeFile(i)} className="text-muted hover:text-red-400 p-1">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
