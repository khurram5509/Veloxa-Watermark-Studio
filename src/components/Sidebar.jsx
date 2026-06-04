import React from 'react';
import { motion } from 'framer-motion';
import { LayoutDashboard, Layers, ScrollText, Settings, Sparkles, Sun, Moon, HelpCircle } from 'lucide-react';
import { useStore } from '../store/useStore';

const items = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'profiles', label: 'Profiles', icon: Layers },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const { view, setView, theme, setTheme, openHelp } = useStore();

  // Responsive: full sidebar (w-56) at xl+ (≥1280px), icon-only rail (w-14)
  // when narrower. Keeps all 4 nav slots clickable + the help/theme buttons
  // visible at every width we support (down to 920px).
  return (
    <aside className="w-14 xl:w-56 shrink-0 surface-1 border-r border-ink-600/50 flex flex-col transition-[width] duration-150">
      <div className="px-2 xl:px-4 pt-5 pb-4 border-b border-ink-600/40 flex justify-center xl:justify-start">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg gradient-veloxa flex items-center justify-center shadow-glow shrink-0" title="Veloxa Watermark Studio">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="hidden xl:block min-w-0">
            <div className="text-sm font-bold leading-tight truncate">Veloxa</div>
            <div className="text-[10px] uppercase tracking-widest text-muted leading-tight truncate">
              Watermark Studio
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              title={item.label}
              className={`relative w-full flex items-center justify-center xl:justify-start gap-3 px-2 xl:px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active ? 'text-white' : 'text-ink-100 hover:bg-white/5'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-veloxa-600/15 border border-veloxa-500/30 rounded-lg"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <Icon className="w-4 h-4 relative z-10 shrink-0" />
              <span className="relative z-10 hidden xl:inline truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-2 xl:p-3 border-t border-ink-600/40 space-y-2">
        <button
          onClick={openHelp}
          title="Help & Documentation (F1)"
          className="w-full flex items-center justify-center xl:justify-start gap-2 px-2 xl:px-3 py-2 rounded-lg surface-2 hover:bg-white/5 text-xs text-ink-100"
        >
          <HelpCircle className="w-3.5 h-3.5 text-veloxa-400 shrink-0"/>
          <span className="hidden xl:inline truncate">Help & Documentation</span>
          <span className="ml-auto text-[10px] text-muted hidden xl:inline">F1</span>
        </button>
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-full flex items-center justify-center xl:justify-between px-2 xl:px-3 py-2 rounded-lg surface-2 hover:bg-white/5 text-xs"
        >
          <span className="flex items-center gap-2 text-ink-100">
            {theme === 'dark' ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            <span className="hidden xl:inline truncate">{theme === 'dark' ? 'Dark mode' : 'Light mode'}</span>
          </span>
          <span className="text-muted hidden xl:inline">Toggle</span>
        </button>
        <div className="text-[10px] text-muted px-1 leading-relaxed hidden xl:block">
          Automated Bulk Document Watermarking — Offline & private.
        </div>
      </div>
    </aside>
  );
}
