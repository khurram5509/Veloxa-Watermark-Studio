import React from 'react';
import { Minus, Square, X, Sparkles, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useStore } from '../store/useStore';

/**
 * Top-of-window chrome — drag handle, app identity, live queue indicator,
 * Windows/Linux window controls (close / minimize / maximize). The macOS
 * native controls are hidden behind a transparent strip on Mac builds; the
 * version chip + queue chip stay visible there too.
 */
export default function TitleBar() {
  const v = window.veloxa;
  const { queue } = useStore();

  // v2.8.1+: read the live app version from the preload bridge. The previous
  // string "v2.4.1" was baked into JSX since v2.4.1 was the current build
  // and never got bumped — every release showed the stale version in the
  // chrome no matter what was actually running. Falls back to '?' so a
  // render before veloxa is ready doesn't crash.
  const appVersion = v?.versions?.app || '?';

  return (
    <div className="app-drag h-9 flex items-center justify-between px-3 bg-ink-800/95 border-b border-ink-600/50 select-none">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-5 h-5 rounded-md gradient-veloxa flex items-center justify-center shadow-glow shrink-0">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-semibold tracking-wide text-ink-100 shrink-0">
          Veloxa Watermark Studio
        </span>
        <span className="text-[10px] uppercase tracking-widest text-ink-200/50 shrink-0">v{appVersion}</span>
        {/* v2.8.2 — Live queue count visible across every view. Users
            previously had to navigate back to Dashboard to see whether a
            batch was still running. Surfaces only when there's something
            in the queue so the title bar stays clean when there isn't. */}
        <QueueStatusChip queue={queue}/>
      </div>
      <div className="app-no-drag flex items-center">
        <button onClick={() => v?.window.minimize()} className="w-9 h-9 hover:bg-white/5 flex items-center justify-center text-ink-100">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => v?.window.maximize()} className="w-9 h-9 hover:bg-white/5 flex items-center justify-center text-ink-100">
          <Square className="w-3 h-3" />
        </button>
        <button onClick={() => v?.window.close()} className="w-9 h-9 hover:bg-red-500 hover:text-white flex items-center justify-center text-ink-100">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Compact queue indicator. Five states map to five appearances:
 *
 *   running   →  spinner · "{ok}/{total} processed"
 *   paused    →  pause icon · "{ok}/{total} (paused)"
 *   pending   →  clock · "{N} queued"
 *   has-fail  →  done badge + small red "·{failed}" suffix
 *   done      →  green check · "{ok}/{total} done"
 *   idle/empty → null (chip not rendered)
 *
 * Reads `queue` from the store at the parent. Designed to be glanceable —
 * users in Settings / Profiles / Logs can see whether their batch is still
 * grinding without switching back to Dashboard.
 */
function QueueStatusChip({ queue }) {
  if (!queue || !queue.counts || queue.counts.total === 0) return null;
  const { total, success, failed, pending, skipped } = queue.counts;
  const finished = success + failed + skipped;

  if (queue.running) {
    return (
      <span
        className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-veloxa-600/15 border border-veloxa-500/30 text-veloxa-300 tabular-nums"
        title={queue.paused ? `Paused at ${success}/${total}` : `Running: ${success} done, ${failed} failed, ${pending} pending`}
      >
        {queue.paused
          ? <Square className="w-2.5 h-2.5"/>
          : <Loader2 className="w-2.5 h-2.5 animate-spin"/>}
        <span>{success}/{total}</span>
        {failed > 0 && <span className="text-rose-400">·{failed}</span>}
      </span>
    );
  }

  if (pending > 0) {
    return (
      <span
        className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-ink-700/60 border border-ink-500/40 text-ink-100 tabular-nums"
        title={`${pending} queued, not started — click PROCESS on the dashboard to begin`}
      >
        <Clock className="w-2.5 h-2.5"/>
        <span>{pending} queued</span>
      </span>
    );
  }

  // Everything finished. Differentiate "all OK" from "some failed".
  if (failed > 0) {
    return (
      <span
        className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-amber-600/15 border border-amber-500/30 text-amber-300 tabular-nums"
        title={`Done: ${success} succeeded, ${failed} failed, ${skipped} skipped`}
      >
        <XCircle className="w-2.5 h-2.5"/>
        <span>{success}/{total}</span>
        <span className="text-rose-400">·{failed}</span>
      </span>
    );
  }

  return (
    <span
      className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-emerald-600/15 border border-emerald-500/30 text-emerald-300 tabular-nums"
      title={`Done: ${success}/${total} succeeded${skipped > 0 ? `, ${skipped} skipped` : ''}`}
    >
      <CheckCircle2 className="w-2.5 h-2.5"/>
      <span>{finished}/{total} done</span>
    </span>
  );
}
