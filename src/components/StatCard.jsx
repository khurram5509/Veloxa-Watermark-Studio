import React from 'react';

export default function StatCard({ icon: Icon, label, value, accent = 'veloxa' }) {
  const accentMap = {
    veloxa: 'text-veloxa-400 bg-veloxa-600/10 border-veloxa-500/20',
    green: 'text-emerald-400 bg-emerald-600/10 border-emerald-500/20',
    red: 'text-rose-400 bg-rose-600/10 border-rose-500/20',
    amber: 'text-amber-400 bg-amber-600/10 border-amber-500/20',
    ink: 'text-ink-200 bg-ink-700/40 border-ink-500/30',
  };
  return (
    <div className="surface-1 rounded-xl px-4 py-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${accentMap[accent]}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}
