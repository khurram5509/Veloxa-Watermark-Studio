import React from 'react';
import { Minus, Square, X, Sparkles } from 'lucide-react';

export default function TitleBar() {
  const v = window.veloxa;
  return (
    <div className="app-drag h-9 flex items-center justify-between px-3 bg-ink-800/95 border-b border-ink-600/50 select-none">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 rounded-md gradient-veloxa flex items-center justify-center shadow-glow">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-semibold tracking-wide text-ink-100">
          Veloxa Watermark Studio
        </span>
        <span className="text-[10px] uppercase tracking-widest text-ink-200/50">v2.4.1</span>
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
