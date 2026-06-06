import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, RotateCcw, Square, Trash2, FolderOpen, FileText,
  Presentation, FileType2, CheckCircle2, XCircle, Loader2, Clock, FolderInput,
  X, CircleX, FilePlus2, GripVertical, Eye, Copy, ArrowUpToLine, ArrowDownToLine,
  FolderOutput, Trash, AlertTriangle,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { basename, ms } from '../utils/format';

const ICONS = {
  '.pdf': FileText, '.docx': FileType2, '.pptx': Presentation,
};

function statusBadge(status) {
  switch (status) {
    case 'success':
      return <span className="chip text-emerald-400 bg-emerald-600/10 border-emerald-500/20"><CheckCircle2 className="w-3 h-3"/> Done</span>;
    case 'failed':
      return <span className="chip text-rose-400 bg-rose-600/10 border-rose-500/20"><XCircle className="w-3 h-3"/> Failed</span>;
    case 'running':
      return <span className="chip text-veloxa-400 bg-veloxa-600/10 border-veloxa-500/20"><Loader2 className="w-3 h-3 animate-spin"/> Running</span>;
    case 'skipped':
      return <span className="chip text-amber-400 bg-amber-600/10 border-amber-500/20"><Square className="w-3 h-3"/> Skipped</span>;
    default:
      return <span className="chip text-ink-200 bg-ink-700/60 border-ink-500/30"><Clock className="w-3 h-3"/> Pending</span>;
  }
}

// "Done" in the queue UI means a job has finished one way or the other:
// success, failed, or skipped. (The user's spec called for a single
// "Clear Done" button covering all three.)
const DONE_STATUSES = new Set(['success', 'failed', 'skipped']);

// Status set that can be retried: success / failed / skipped — anything
// the engine considers "finished" can be re-queued. Running can't retry
// because the worker is still attached.
const RETRYABLE_STATUSES = new Set(['success', 'failed', 'skipped']);

export default function QueuePanel() {
  const { queue, addPendingFiles } = useStore();
  const v = window.veloxa;

  // ---- Selection state (multi-select) ---------------------------------
  // Set<jobId>. Cleared on outside click / Esc. Anchor stores the last
  // single-click target so Shift+Click can compute a range correctly.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const anchorIdRef = useRef(null);

  // Drag-and-drop reordering — tracks the row currently being dragged AND
  // the index where it would be inserted on drop. The rendered list reads
  // `dragOverIndex` to show a thin blue insertion indicator between rows.
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Right-click context menu — null when closed; an object when open.
  const [contextMenu, setContextMenu] = useState(null);

  // Destructive-delete confirm modal state. `kind` is 'source' or 'output'
  // so the same modal component handles both flows; `targets` is the list
  // of {id, source, output} pairs the user wants to delete; null = closed.
  const [confirmDelete, setConfirmDelete] = useState(null);

  // When jobs are removed from the queue we prune them from selectedIds
  // so the toolbar's "Remove selected" button doesn't appear active for
  // ghost ids that no longer exist.
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(queue.jobs.map((j) => j.id));
      let changed = false;
      const next = new Set();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [queue.jobs]);

  // Keyboard: Esc clears selection / closes context menu / closes modal.
  // Ctrl+A within the panel selects every visible row. We attach this
  // to the document but guard against firing while a modal/textarea is
  // focused (the modal handles its own Escape elsewhere).
  useEffect(() => {
    const onKey = (e) => {
      if (confirmDelete) return; // modal owns the key handling
      if (e.key === 'Escape') {
        setContextMenu(null);
        setSelectedIds(new Set());
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && document.activeElement?.tagName !== 'INPUT'
          && document.activeElement?.tagName !== 'TEXTAREA') {
        // Only react if focus is in the queue panel area
        const queueEl = document.getElementById('veloxa-queue-list');
        if (queueEl && queueEl.contains(document.activeElement || document.body)) {
          e.preventDefault();
          setSelectedIds(new Set(queue.jobs.map((j) => j.id)));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queue.jobs, confirmDelete]);

  // Close context menu on any click outside it. The menu's own onMouseDown
  // stops propagation so clicking inside doesn't immediately close.
  useEffect(() => {
    if (!contextMenu) return;
    const onClick = () => setContextMenu(null);
    window.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', onClick, true);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onClick, true);
    };
  }, [contextMenu]);

  // ---- Selection handlers ---------------------------------------------
  const handleRowClick = useCallback((e, jobId) => {
    if (e.shiftKey && anchorIdRef.current) {
      // Range from anchor to current
      const ids = queue.jobs.map((j) => j.id);
      const a = ids.indexOf(anchorIdRef.current);
      const b = ids.indexOf(jobId);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = new Set(ids.slice(lo, hi + 1));
        if (e.ctrlKey || e.metaKey) {
          // Ctrl+Shift = additive range
          setSelectedIds((prev) => new Set([...prev, ...range]));
        } else {
          setSelectedIds(range);
        }
      }
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle this row, anchor moves to it
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(jobId)) next.delete(jobId);
        else next.add(jobId);
        return next;
      });
      anchorIdRef.current = jobId;
    } else {
      // Plain click: select only this row
      setSelectedIds(new Set([jobId]));
      anchorIdRef.current = jobId;
    }
  }, [queue.jobs]);

  // Right-clicking a row that's already in the selection acts on the
  // whole selection. Right-clicking outside the selection moves the
  // selection to JUST that row first (matching Finder / Explorer UX).
  const handleRowContextMenu = useCallback((e, job) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIds((prev) => {
      if (prev.has(job.id)) return prev;
      anchorIdRef.current = job.id;
      return new Set([job.id]);
    });
    setContextMenu({ x: e.clientX, y: e.clientY, jobId: job.id });
  }, []);

  // Empty-area click: deselect all (and close context menu).
  const handleListClick = useCallback((e) => {
    if (e.target.closest('[data-row-id]')) return;
    setSelectedIds(new Set());
    anchorIdRef.current = null;
  }, []);

  // ---- Drag and drop reordering ---------------------------------------
  // HTML5-native. The dragged row's id goes in dataTransfer so we can read
  // it in dragover for boundary calcs. We compute the "insert position"
  // (index between two rows) from the mouse position relative to the
  // currently-hovered row's vertical midpoint.
  const handleDragStart = useCallback((e, jobId) => {
    e.dataTransfer.setData('text/x-veloxa-job', jobId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedId(jobId);
  }, []);

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAfter = (e.clientY - rect.top) > (rect.height / 2);
    setDragOverIndex(insertAfter ? index + 1 : index);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    const movedId = e.dataTransfer.getData('text/x-veloxa-job');
    if (!movedId || dragOverIndex === null) {
      handleDragEnd();
      return;
    }
    // Build the new order: remove the dragged id, then splice it back at
    // dragOverIndex. If multiple rows are selected AND the dragged row is
    // one of them, move the whole selection (preserving relative order).
    const draggingSelection = selectedIds.has(movedId) && selectedIds.size > 1;
    const movingIds = draggingSelection
      ? queue.jobs.map((j) => j.id).filter((id) => selectedIds.has(id))
      : [movedId];
    const stayingIds = queue.jobs.map((j) => j.id).filter((id) => !movingIds.includes(id));
    // dragOverIndex was computed against the ORIGINAL list; subtract the
    // number of moved rows that were before it so the insert lands where
    // the user actually pointed.
    const movedBefore = queue.jobs.slice(0, dragOverIndex).filter((j) => movingIds.includes(j.id)).length;
    const adjustedIndex = Math.max(0, dragOverIndex - movedBefore);
    const newOrder = [...stayingIds.slice(0, adjustedIndex), ...movingIds, ...stayingIds.slice(adjustedIndex)];

    handleDragEnd();
    await v?.engine.reorderJobs(newOrder);
  }, [v, queue.jobs, selectedIds, dragOverIndex, handleDragEnd]);

  // ---- Add files via the OS file picker (toolbar button) ---------------
  // Same flow as DropZone's Add files button: pick → expand → push to
  // pendingFiles staging. From there the user clicks PROCESS to actually
  // enqueue with the selected profile. We deliberately don't enqueue
  // directly from here because (a) the user might want to pick a profile
  // first and (b) it keeps the "staging → process" mental model intact.
  const handleAddFiles = useCallback(async () => {
    if (!v?.app?.pickFiles) return;
    const picked = await v.app.pickFiles();
    if (picked?.length) addPendingFiles(picked);
  }, [v, addPendingFiles]);

  // ---- Toolbar action handlers ----------------------------------------
  // These work on the current selection where applicable.
  const selectedJobs = useMemo(
    () => queue.jobs.filter((j) => selectedIds.has(j.id)),
    [queue.jobs, selectedIds],
  );
  const selectedIdsArr = useMemo(() => selectedJobs.map((j) => j.id), [selectedJobs]);

  const handleRemoveSelected = useCallback(async () => {
    if (selectedIdsArr.length === 0) return;
    await v?.engine.removeJobs(selectedIdsArr);
    setSelectedIds(new Set());
  }, [v, selectedIdsArr]);

  const handleClearDone = useCallback(async () => {
    await v?.engine.clearDone();
  }, [v]);

  const handleClearAll = useCallback(async () => {
    await v?.engine.clearAll();
    setSelectedIds(new Set());
  }, [v]);

  // ---- Context-menu action handlers ----------------------------------
  // Each takes the menu's anchor job (the one right-clicked). When the
  // anchor is inside the multi-selection, the op runs on the selection.
  // When the anchor is solo, the op runs on just that row.
  const buildTargetIds = useCallback((anchorJobId) => {
    if (selectedIds.has(anchorJobId) && selectedIds.size > 1) {
      return [...selectedIds];
    }
    return [anchorJobId];
  }, [selectedIds]);

  const handlePreview = useCallback(async (job) => {
    if (!v?.app?.openPath) return;
    // Open the source file in the OS-default app. (User's chosen "preview"
    // option from the design pass: cheapest to ship, works for all 3
    // formats by deferring to whatever has the file association.)
    await v.app.openPath(job.input);
  }, [v]);

  const handleOpenSourceFolder = useCallback(async (job) => {
    if (!v?.app?.showInFolder) return;
    await v.app.showInFolder(job.input);
  }, [v]);

  const handleOpenOutputFolder = useCallback(async (job) => {
    if (!v?.app?.showInFolder || !job.output) return;
    await v.app.showInFolder(job.output);
  }, [v]);

  const handleMoveTo = useCallback(async (anchorJob, where) => {
    const ids = buildTargetIds(anchorJob.id);
    await v?.engine.moveJobsTo(ids, where);
  }, [v, buildTargetIds]);

  const handleDuplicate = useCallback(async (anchorJob) => {
    const ids = buildTargetIds(anchorJob.id);
    await v?.engine.duplicateJobs(ids);
  }, [v, buildTargetIds]);

  const handleRetryRows = useCallback(async (anchorJob) => {
    const ids = buildTargetIds(anchorJob.id)
      // The engine ignores running rows but we filter here too so the
      // toolbar count we show matches what actually happens.
      .filter((id) => {
        const j = queue.jobs.find((x) => x.id === id);
        return j && RETRYABLE_STATUSES.has(j.status);
      });
    if (ids.length === 0) return;
    await v?.engine.retryRows(ids);
  }, [v, queue.jobs, buildTargetIds]);

  const handleRemoveFromQueue = useCallback(async (anchorJob) => {
    const ids = buildTargetIds(anchorJob.id);
    await v?.engine.removeJobs(ids);
    setSelectedIds(new Set());
  }, [v, buildTargetIds]);

  // Two separate flows per v2.8.1 spec: "Delete source from disk" vs
  // "Delete output from disk". Each gets its own context menu item so
  // it's never ambiguous which file is going away. kind: 'source' | 'output'.
  const handleDeleteFromDisk = useCallback((anchorJob, kind = 'source') => {
    const ids = buildTargetIds(anchorJob.id);
    const targets = ids
      .map((id) => queue.jobs.find((j) => j.id === id))
      .filter(Boolean)
      .map((j) => ({ id: j.id, source: j.input, output: j.output || null }));
    // For "output" delete, drop rows that don't have an output yet — there's
    // nothing on disk to remove for them.
    const filtered = kind === 'output' ? targets.filter((t) => !!t.output) : targets;
    if (filtered.length === 0) return;
    setConfirmDelete({ kind, targets: filtered });
  }, [queue.jobs, buildTargetIds]);

  // ---- Progress bar ---------------------------------------------------
  const fraction = useMemo(() => {
    const c = queue.counts;
    if (!c.total) return 0;
    return (c.success + c.failed + c.skipped) / c.total;
  }, [queue.counts]);

  // Header summary text — empty state shows "0 files" per spec; populated
  // state shows "{success}/{total} processed · {pending} pending".
  const summaryText = queue.jobs.length === 0
    ? '0 files'
    : `${queue.counts.success}/${queue.counts.total} processed`
      + (queue.counts.pending > 0 ? ` · ${queue.counts.pending} pending` : '');

  const hasDone = queue.counts.success + queue.counts.failed + queue.counts.skipped > 0;

  return (
    <div className="surface-1 rounded-2xl flex flex-col flex-1 min-h-0">
      {/* ---- Top toolbar ---- */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600/40 flex-wrap gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="text-sm font-semibold">Processing Queue</h2>
          <span className="text-xs text-muted tabular-nums">{summaryText}</span>
          {selectedIds.size > 0 && (
            <span className="chip text-veloxa-400 bg-veloxa-600/10 border-veloxa-500/30 text-[10px]">
              {selectedIds.size} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={handleAddFiles} className="btn-outline text-xs" title="Add files to the staging area (Ctrl+O)">
            <FilePlus2 className="w-3.5 h-3.5"/> Add files
          </button>
          {queue.running && !queue.paused && (
            <button onClick={() => v?.engine.pause()} className="btn-outline text-xs">
              <Pause className="w-3.5 h-3.5"/> Pause
            </button>
          )}
          {queue.paused && (
            <button onClick={() => v?.engine.resume()} className="btn-outline text-xs">
              <Play className="w-3.5 h-3.5"/> Resume
            </button>
          )}
          <button onClick={() => v?.engine.retryFailed()}
                  disabled={queue.counts.failed === 0}
                  className="btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Re-queue all failed rows">
            <RotateCcw className="w-3.5 h-3.5"/>
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={handleRemoveSelected}
              className="btn-ghost text-xs text-rose-400"
              title={`Remove ${selectedIds.size} selected row${selectedIds.size === 1 ? '' : 's'}`}
            >
              <X className="w-3.5 h-3.5"/> Remove selected
            </button>
          )}
          <button
            onClick={handleClearDone}
            disabled={!hasDone}
            className="btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed"
            title="Clear all finished rows (Success + Failed + Skipped)"
          >
            <Trash2 className="w-3.5 h-3.5"/> Clear done
          </button>
          <button
            onClick={handleClearAll}
            disabled={queue.jobs.length === 0}
            className="btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed"
            title="Clear everything (also cancels if running)"
          >
            Clear all
          </button>
          {queue.running && (
            <button onClick={() => v?.engine.cancel()} className="btn-ghost text-xs text-rose-400">
              <Square className="w-3.5 h-3.5"/> Stop
            </button>
          )}
        </div>
      </div>

      {/* ---- Progress bar ---- */}
      <div className="px-5 py-2 border-b border-ink-600/40">
        <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
          <motion.div
            className="h-full gradient-veloxa"
            animate={{ width: `${Math.round(fraction * 100)}%` }}
            transition={{ ease: 'easeOut', duration: 0.4 }}
          />
        </div>
      </div>

      {/* ---- Empty / populated list ---- */}
      <div
        id="veloxa-queue-list"
        className="flex-1 overflow-auto p-2 min-h-0"
        onClick={handleListClick}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        tabIndex={-1}
      >
        {queue.jobs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted text-sm py-12">
            <FolderInput className="w-8 h-8 mb-3 opacity-50"/>
            <div className="font-medium">0 files in queue</div>
            <div className="text-xs mt-1">
              Drop files / folders or click <span className="text-veloxa-400 font-semibold">Add files</span>,
              then hit <span className="text-veloxa-400 font-semibold">PROCESS</span>.
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {queue.jobs.map((job, index) => {
                const ext = (job.input.match(/\.[^.]+$/) || [''])[0].toLowerCase();
                const Icon = ICONS[ext] || FileText;
                const isSelected = selectedIds.has(job.id);
                const isRunning = job.status === 'running';
                const showInsertBefore = dragOverIndex === index && draggedId && draggedId !== job.id;
                return (
                  <React.Fragment key={job.id}>
                    {showInsertBefore && (
                      <div className="h-0.5 bg-veloxa-500 rounded-full mx-3 -my-0.5" aria-hidden/>
                    )}
                    <motion.div
                      data-row-id={job.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: draggedId === job.id ? 0.4 : 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      draggable={!isRunning}
                      onDragStart={(e) => handleDragStart(e, job.id)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                      onClick={(e) => handleRowClick(e, job.id)}
                      onContextMenu={(e) => handleRowContextMenu(e, job)}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-veloxa-600/15 border border-veloxa-500/40'
                          : 'border border-transparent hover:bg-white/5'
                      }`}
                    >
                      {/* Drag handle. Hidden on running rows because the engine
                          loop pins them in place — reordering would point the
                          worker at a different row mid-stream. */}
                      <GripVertical
                        className={`w-4 h-4 shrink-0 ${isRunning ? 'text-muted opacity-20' : 'text-muted opacity-50'}`}
                        aria-label={isRunning ? 'Running — cannot reorder' : 'Drag to reorder'}
                      />
                      <Icon className="w-4 h-4 text-veloxa-400 shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{basename(job.input)}</div>
                        <div className="text-[11px] text-muted truncate">
                          {job.output ? `→ ${basename(job.output)}` : job.input}
                          {job.error ? ` — ${job.error}` : ''}
                        </div>
                      </div>
                      <div className="text-[11px] text-muted tabular-nums w-16 text-right">
                        {job.durationMs ? ms(job.durationMs) : ''}
                      </div>
                      {statusBadge(job.status)}
                      {job.output && (
                        <button
                          onClick={(e) => { e.stopPropagation(); v?.app.showInFolder(job.output); }}
                          className="btn-ghost p-1.5"
                          title="Show in folder"
                        >
                          <FolderOpen className="w-3.5 h-3.5"/>
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); v?.engine.removeJob(job.id); }}
                        disabled={isRunning}
                        className="btn-ghost p-1.5 text-muted hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={isRunning ? 'Cancel queue first to remove a running job' : 'Remove from queue'}
                      >
                        <X className="w-3.5 h-3.5"/>
                      </button>
                    </motion.div>
                  </React.Fragment>
                );
              })}
              {/* Insert-at-end indicator */}
              {dragOverIndex === queue.jobs.length && draggedId && (
                <div className="h-0.5 bg-veloxa-500 rounded-full mx-3" aria-hidden/>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ---- Right-click context menu ---- */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          job={queue.jobs.find((j) => j.id === contextMenu.jobId)}
          selectionCount={selectedIds.has(contextMenu.jobId) ? selectedIds.size : 1}
          actions={{
            preview: handlePreview,
            openSourceFolder: handleOpenSourceFolder,
            openOutputFolder: handleOpenOutputFolder,
            moveTo: handleMoveTo,
            duplicate: handleDuplicate,
            retry: handleRetryRows,
            remove: handleRemoveFromQueue,
            deleteFromDisk: handleDeleteFromDisk,
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* ---- Delete-from-disk confirm modal (source OR output) ---- */}
      {confirmDelete && (
        <ConfirmDeleteModal
          kind={confirmDelete.kind}
          targets={confirmDelete.targets}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const paths = confirmDelete.targets.map((t) =>
              confirmDelete.kind === 'output' ? t.output : t.source);
            const result = confirmDelete.kind === 'output'
              ? await v?.engine?.deleteOutputFiles(paths)
              : await v?.engine?.deleteSourceFiles(paths);
            setConfirmDelete(null);
            if (result && result.errors && result.errors.length > 0) {
              // Surface failures inline (not a toast — those weren't part of
              // this slice). The user will see the file still present in
              // Explorer; that's the signal a delete failed.
              console.warn(`delete${confirmDelete.kind === 'output' ? 'Output' : 'Source'}Files partial:`, result);
            }
            // Don't auto-remove rows from the queue — the user might want
            // to inspect or re-process; let them dismiss via "Remove from
            // Queue" separately if they want.
          }}
        />
      )}
    </div>
  );
}

// =========================================================================
// Context Menu — fixed-position popup at the right-click coordinates.
// Auto-clamps to the viewport so it doesn't overflow off the right/bottom
// edge. mousedown.stopPropagation prevents the document-level "click
// outside to close" listener from firing on its own items.
// =========================================================================
function ContextMenu({ x, y, job, selectionCount, actions, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp to viewport after first paint so we know the menu's real height.
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (x + rect.width > vw - 4) nx = vw - rect.width - 4;
    if (y + rect.height > vh - 4) ny = vh - rect.height - 4;
    setPos({ x: Math.max(4, nx), y: Math.max(4, ny) });
  }, [x, y]);

  if (!job) return null;
  const isMulti = selectionCount > 1;
  const labelSuffix = isMulti ? ` (${selectionCount})` : '';
  const canShowOutput = !!job.output;
  const canRetry = RETRYABLE_STATUSES.has(job.status);

  const items = [
    { icon: Eye, label: 'Preview row', onClick: () => actions.preview(job), disabled: isMulti },
    { icon: FolderOpen, label: 'Open source folder', onClick: () => actions.openSourceFolder(job), disabled: isMulti },
    { icon: FolderOutput, label: 'Open output folder', onClick: () => actions.openOutputFolder(job), disabled: !canShowOutput || isMulti },
    { divider: true },
    { icon: ArrowUpToLine, label: `Move to top${labelSuffix}`, onClick: () => actions.moveTo(job, 'top') },
    { icon: ArrowDownToLine, label: `Move to bottom${labelSuffix}`, onClick: () => actions.moveTo(job, 'bottom') },
    { divider: true },
    { icon: Copy, label: `Duplicate row${isMulti ? 's' + labelSuffix : ''}`, onClick: () => actions.duplicate(job) },
    { icon: RotateCcw, label: `Retry${isMulti ? ' rows' + labelSuffix : ''}`, onClick: () => actions.retry(job), disabled: !canRetry },
    { divider: true },
    { icon: X, label: `Remove from queue${labelSuffix}`, onClick: () => actions.remove(job) },
    // Two separate delete items per v2.8.1 spec — each opens its own
    // confirm modal. Source delete propagates through cloud sync (Dropbox
    // / OneDrive / iCloud) to all devices; output delete is local-only
    // unless the user chose to put outputs on a synced path.
    { icon: Trash, label: `Delete source from disk${labelSuffix}`, onClick: () => actions.deleteFromDisk(job, 'source'), danger: true },
    {
      icon: Trash,
      label: `Delete output from disk${labelSuffix}`,
      onClick: () => actions.deleteFromDisk(job, 'output'),
      danger: true,
      disabled: !canShowOutput && !isMulti,
    },
  ];

  return (
    <div
      ref={ref}
      role="menu"
      style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000 }}
      className="surface-1 rounded-lg shadow-2xl border border-ink-600/60 py-1 min-w-[220px] backdrop-blur-md"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-muted border-b border-ink-600/40 mb-1">
        {isMulti ? `${selectionCount} rows` : basename(job.input)}
      </div>
      {items.map((it, i) =>
        it.divider ? (
          <div key={`d${i}`} className="my-1 border-t border-ink-600/40"/>
        ) : (
          <button
            key={it.label}
            disabled={it.disabled}
            onClick={() => { it.onClick(); onClose(); }}
            className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
              it.disabled
                ? 'text-muted opacity-40 cursor-not-allowed'
                : it.danger
                  ? 'text-rose-400 hover:bg-rose-600/10'
                  : 'text-ink-100 hover:bg-white/5'
            }`}
          >
            <it.icon className="w-3.5 h-3.5 shrink-0"/>
            <span className="truncate">{it.label}</span>
          </button>
        )
      )}
    </div>
  );
}

// =========================================================================
// Confirm Delete Modal — destructive, requires explicit "Delete" click
// (no quick-confirm). Lists the source paths so the user knows exactly
// what gets unlinked. Esc cancels; Enter on focused button confirms.
// =========================================================================
function ConfirmDeleteModal({ kind = 'source', targets, onCancel, onConfirm }) {
  // Local "I understand" checkbox to avoid one-click destructive accidents.
  // Both 'source' and 'output' delete paths require it — the kinds differ
  // only in which file gets unlinked and the warning copy.
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Copy adapts to kind: 'source' or 'output'.
  const isOutput = kind === 'output';
  const fileWord = isOutput ? 'output file' : 'source file';
  const title = `Delete ${fileWord}${targets.length === 1 ? '' : 's'} from disk?`;
  const warning = isOutput
    ? (
      <>
        This permanently removes the watermarked output{targets.length === 1 ? '' : 's'} from your filesystem.
        {' '}<b className="text-ink-100">Source documents are NOT touched</b> — your originals stay intact.
        {' '}You can re-create the output{targets.length === 1 ? '' : 's'} by re-processing the source through the queue.
      </>
    ) : (
      <>
        This permanently removes the source document{targets.length === 1 ? '' : 's'} from your filesystem.
        {' '}<b className="text-ink-100">Watermarked outputs are NOT touched</b> — they stay where they are.
        {' '}Cannot be undone, and may propagate the delete through cloud sync (Dropbox / OneDrive / iCloud)
        to all your devices.
      </>
    );
  const pathOf = (t) => isOutput ? t.output : t.source;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="surface-1 rounded-xl border border-rose-500/40 max-w-md w-full p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-rose-600/15 text-rose-400 border border-rose-500/30 shrink-0">
            <AlertTriangle className="w-4 h-4"/>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="text-xs text-muted mt-1">{warning}</p>
          </div>
        </div>
        <div className="surface-2 rounded-lg p-2 max-h-40 overflow-auto text-[11px] font-mono space-y-0.5 mb-3">
          {targets.map((t) => (
            <div key={t.id} className="truncate text-muted" title={pathOf(t)}>{pathOf(t)}</div>
          ))}
        </div>
        <label className="flex items-start gap-2 text-xs cursor-pointer mb-3">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5"
          />
          <span>I understand this can't be undone.</span>
        </label>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn-outline text-xs">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!acknowledged}
            className={`btn text-xs px-4 ${
              acknowledged
                ? 'bg-rose-600 hover:bg-rose-500 text-white'
                : 'bg-rose-600/40 text-white/60 cursor-not-allowed'
            }`}
          >
            <Trash className="w-3.5 h-3.5"/> Delete {targets.length === 1 ? `1 ${fileWord}` : `${targets.length} ${fileWord}s`}
          </button>
        </div>
      </div>
    </div>
  );
}
