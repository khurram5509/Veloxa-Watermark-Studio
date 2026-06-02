import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { UploadCloud, FolderOpen, FilePlus2, Trash2, FileText, Presentation, FileType2, CheckCircle2, Clock, HardDrive } from 'lucide-react';
import { useStore } from '../store/useStore';
import { basename, ext, bytes as fmtBytes, ms as fmtMs } from '../utils/format';

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
  const queue = useStore((s) => s.queue);
  const [active, setActive] = useState(false);
  const [sizes, setSizes] = useState({}); // path → bytes
  const dragDepth = useRef(0);
  const v = window.veloxa;

  // Fetch sizes for any staged file we haven't measured yet. Batched IPC
  // so dragging 200 files is one round-trip, not 200.
  useEffect(() => {
    if (!v?.app?.getFileSizes) return;
    const unknown = pendingFiles.filter((p) => sizes[p] === undefined);
    if (!unknown.length) return;
    v.app.getFileSizes(unknown).then((map) => {
      setSizes((prev) => ({ ...prev, ...map }));
    }).catch(() => {});
  }, [pendingFiles]);

  // Aggregate stats + time estimate.
  // Time estimate uses the rolling average duration per byte from completed
  // queue history when available, otherwise a reasonable PDF-heavy heuristic
  // (8 ms per MB, capped at 0.5s per file as a floor).
  const stats = useMemo(() => {
    let totalBytes = 0;
    let known = 0;
    for (const p of pendingFiles) {
      const s = sizes[p];
      if (typeof s === 'number') { totalBytes += s; known += 1; }
    }
    // Per-byte rate from history
    let msPerByte = null;
    const done = (queue.jobs || []).filter((j) => j.status === 'success' && j.durationMs && j.bytes);
    if (done.length >= 3) {
      const totalMs = done.reduce((acc, j) => acc + j.durationMs, 0);
      const totalB  = done.reduce((acc, j) => acc + j.bytes, 0);
      if (totalB > 0) msPerByte = totalMs / totalB;
    }
    // Heuristic fallback: 8 ms per MB ≈ 0.008 ms per byte / 1024 ≈ 7.6e-6
    if (msPerByte == null || !Number.isFinite(msPerByte)) msPerByte = 8 / (1024 * 1024);

    // Min per-file overhead — Office COM startups dominate for tiny files
    const minPerFile = 500;
    let estMs = 0;
    for (const p of pendingFiles) {
      const s = sizes[p];
      const fileMs = (typeof s === 'number') ? Math.max(minPerFile, s * msPerByte) : minPerFile * 6;
      estMs += fileMs;
    }
    // Divide by concurrency (best-case parallel processing)
    const concurrency = Math.max(1, useStore.getState().settings?.maxConcurrent || 4);
    const wallMs = Math.round(estMs / concurrency);
    return { count: pendingFiles.length, totalBytes, knownSizes: known, estMs: wallMs };
  }, [pendingFiles, sizes, queue.jobs]);

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
              Bulk-process documents in parallel. Folders are scanned recursively.
            </div>
          </div>
          {/* Supported-formats pills — answers "what can this app actually do?" */}
          <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1">
            {[
              { label: 'PDF' },
              { label: 'DOCX' },
              { label: 'PPTX' },
              { label: 'Folder Processing' },
              { label: 'Recursive Scanning' },
            ].map(({ label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold text-emerald-300/90 bg-emerald-600/10 border border-emerald-500/30 px-2 py-0.5 rounded-full"
              >
                <CheckCircle2 className="w-3 h-3"/> {label}
              </span>
            ))}
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

      {/* Stats row — when files are staged, show count + size + ETA at a
          glance so the user knows the scope of what they're about to run. */}
      {pendingFiles.length === 0 ? (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted">No files staged. Drop files above to begin.</div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="grid grid-cols-3 gap-3 flex-1">
            <StatTile
              icon={FilePlus2}
              label={`File${stats.count === 1 ? '' : 's'}`}
              value={stats.count}
            />
            <StatTile
              icon={HardDrive}
              label="Total size"
              value={stats.knownSizes > 0
                ? fmtBytes(stats.totalBytes) + (stats.knownSizes < stats.count ? '+' : '')
                : '…'}
            />
            <StatTile
              icon={Clock}
              label="Est. time"
              value={fmtMs(stats.estMs)}
              hint="Estimated from history + concurrency"
            />
          </div>
          <button onClick={clearPendingFiles} className="btn-ghost text-xs shrink-0">
            <Trash2 className="w-3.5 h-3.5" /> Clear all
          </button>
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="max-h-44 overflow-auto pr-1 space-y-1.5">
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

function StatTile({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-ink-500/40 bg-ink-700/30 px-3 py-2 flex items-center gap-2.5" title={hint || ''}>
      <div className="w-7 h-7 rounded-lg bg-veloxa-600/15 text-veloxa-300 border border-veloxa-500/30 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5"/>
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-muted leading-none">{label}</div>
        <div className="text-sm font-semibold text-ink-100 mt-0.5 truncate">{value}</div>
      </div>
    </div>
  );
}
