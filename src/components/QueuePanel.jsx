import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, RotateCcw, Square, Trash2, FolderOpen, FileText,
  Presentation, FileType2, CheckCircle2, XCircle, Loader2, Clock, FolderInput,
  X, CircleX,
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

export default function QueuePanel() {
  const { queue } = useStore();
  const v = window.veloxa;

  const fraction = useMemo(() => {
    const c = queue.counts;
    if (!c.total) return 0;
    return (c.success + c.failed + c.skipped) / c.total;
  }, [queue.counts]);

  return (
    <div className="surface-1 rounded-2xl flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600/40">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Processing Queue</h2>
          <span className="text-xs text-muted tabular-nums">
            {queue.counts.success}/{queue.counts.total} processed
          </span>
        </div>
        <div className="flex items-center gap-1.5">
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
          <button onClick={() => v?.engine.retryFailed()} className="btn-ghost text-xs" title="Retry failed">
            <RotateCcw className="w-3.5 h-3.5"/>
          </button>
          {queue.counts.failed > 0 && (
            <button
              onClick={() => v?.engine.clearFailed()}
              className="btn-ghost text-xs text-rose-400"
              title={`Clear ${queue.counts.failed} failed`}
            >
              <CircleX className="w-3.5 h-3.5"/> Clear failed
            </button>
          )}
          <button onClick={() => v?.engine.clearCompleted()} className="btn-ghost text-xs" title="Clear completed">
            <Trash2 className="w-3.5 h-3.5"/> Clear done
          </button>
          <button onClick={() => v?.engine.clearAll()} className="btn-ghost text-xs" title="Clear everything (also cancels if running)">
            Clear all
          </button>
          {queue.running && (
            <button onClick={() => v?.engine.cancel()} className="btn-ghost text-xs text-rose-400">
              <Square className="w-3.5 h-3.5"/> Stop
            </button>
          )}
        </div>
      </div>

      <div className="px-5 py-2 border-b border-ink-600/40">
        <div className="h-1.5 rounded-full bg-ink-700 overflow-hidden">
          <motion.div
            className="h-full gradient-veloxa"
            animate={{ width: `${Math.round(fraction * 100)}%` }}
            transition={{ ease: 'easeOut', duration: 0.4 }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-2 min-h-0">
        {queue.jobs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted text-sm py-12">
            <FolderInput className="w-8 h-8 mb-3 opacity-50"/>
            Queue is empty. Drop files and click <span className="mx-1 text-veloxa-400 font-semibold">PROCESS</span> to begin.
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence initial={false}>
              {queue.jobs.map((job) => {
                const ext = (job.input.match(/\.[^.]+$/) || [''])[0].toLowerCase();
                const Icon = ICONS[ext] || FileText;
                return (
                  <motion.div
                    key={job.id}
                    layout
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5"
                  >
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
                        onClick={() => v?.app.showInFolder(job.output)}
                        className="btn-ghost p-1.5"
                        title="Show in folder"
                      >
                        <FolderOpen className="w-3.5 h-3.5"/>
                      </button>
                    )}
                    {/* Per-row remove. Disabled while running — must cancel
                        first to avoid orphaning a live worker. Visible always
                        (not hover-only) so failed rows are obviously
                        dismissable — the previous behavior was the source of
                        "I can't delete these failed items" complaints. */}
                    <button
                      onClick={() => v?.engine.removeJob(job.id)}
                      disabled={job.status === 'running'}
                      className="btn-ghost p-1.5 text-muted hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={job.status === 'running' ? 'Cancel queue first to remove a running job' : 'Remove from queue'}
                    >
                      <X className="w-3.5 h-3.5"/>
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
