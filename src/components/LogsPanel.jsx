import React, { useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';

const LEVEL_STYLE = {
  info: 'text-ink-100',
  success: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-rose-400',
};

function fmtTs(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

export default function LogsPanel({ compact = false }) {
  const { logs, clearLogs } = useStore();
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <div className="surface-1 rounded-2xl flex flex-col">
      <div className="px-4 py-2.5 border-b border-ink-600/40 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Processing Logs</h2>
        <button onClick={clearLogs} className="btn-ghost text-xs">
          <Trash2 className="w-3.5 h-3.5"/> Clear
        </button>
      </div>
      <div ref={ref} className={`overflow-auto px-4 py-2 font-mono text-[11px] leading-relaxed ${compact ? 'h-48' : 'flex-1 min-h-0'}`}>
        {logs.length === 0 ? (
          <div className="text-muted text-center py-6">No log entries yet.</div>
        ) : (
          logs.map((l, i) => (
            <div key={i} className="flex gap-2">
              <span className="text-muted shrink-0">{fmtTs(l.ts)}</span>
              <span className={`uppercase shrink-0 w-14 ${LEVEL_STYLE[l.level] || 'text-ink-100'}`}>{l.level}</span>
              <span className="text-ink-100">{l.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
