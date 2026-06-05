import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Star, Copy, Trash2, Pencil, Download, Upload, FileType,
  Image as ImageIcon, Layers, Search, X, CheckSquare, Square,
} from 'lucide-react';
import { useStore } from '../store/useStore';

function profileTypeIcon(t) {
  if (t === 'image') return ImageIcon;
  if (t === 'combined') return Layers;
  return FileType;
}

export default function ProfilesPanel({ compact = false }) {
  const {
    profiles, selectedProfileId, setSelectedProfile,
    loadProfiles, startEditingProfile,
    renamingProfileId, setRenamingProfileId,
    selectedProfileIdSet, toggleProfileSelected, clearSelectedProfiles,
  } = useStore();
  const v = window.veloxa;
  const [query, setQuery] = useState('');
  // Alias for clarity in this component
  const renamingId = renamingProfileId;
  const setRenamingId = setRenamingProfileId;
  const selectedCount = selectedProfileIdSet.size;

  const filtered = useMemo(() => {
    if (!query.trim()) return profiles;
    const q = query.trim().toLowerCase();
    return profiles.filter((p) =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.text && p.text.toLowerCase().includes(q))
    );
  }, [profiles, query]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this profile?')) return;
    await v?.profiles.delete(id);
    await loadProfiles();
  };
  const handleDuplicate = async (id) => {
    await v?.profiles.duplicate(id);
    await loadProfiles();
  };
  const handleSetDefault = async (id) => {
    await v?.profiles.setDefault(id);
    await loadProfiles();
  };
  const handleExport = async (id) => {
    await v?.profiles.export(id);
  };
  const handleImport = async () => {
    await v?.profiles.import();
    await loadProfiles();
  };
  const handleBulkDelete = async () => {
    if (selectedCount === 0) return;
    if (!confirm(`Delete ${selectedCount} profile${selectedCount === 1 ? '' : 's'}?`)) return;
    for (const id of selectedProfileIdSet) {
      await v?.profiles.delete(id);
    }
    clearSelectedProfiles();
    await loadProfiles();
  };
  const handleBulkDuplicate = async () => {
    for (const id of selectedProfileIdSet) {
      await v?.profiles.duplicate(id);
    }
    clearSelectedProfiles();
    await loadProfiles();
  };
  const handleBulkExport = async () => {
    for (const id of selectedProfileIdSet) {
      await v?.profiles.export(id);
    }
  };

  const handleRename = async (id, newName) => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    const trimmed = (newName || '').trim();
    if (!trimmed || trimmed === profile.name) {
      setRenamingId(null);
      return;
    }
    await v?.profiles.save({ ...profile, name: trimmed });
    await loadProfiles();
    setRenamingId(null);
  };

  return (
    <div className="surface-1 rounded-2xl flex flex-col">
      <div className="px-4 py-3 border-b border-ink-600/40 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold shrink-0">Watermark Profiles</h2>
        <div className="flex items-center gap-1">
          <button onClick={handleImport} className="btn-ghost text-xs" title="Import profile">
            <Upload className="w-3.5 h-3.5"/>
          </button>
          <button onClick={() => startEditingProfile(null)} className="btn-primary text-xs">
            <Plus className="w-3.5 h-3.5"/> New
          </button>
        </div>
      </div>

      {/* Bulk-action bar (only when something is selected) */}
      <AnimatePresence>
        {selectedCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="mx-3 mt-2 px-3 py-2 rounded-lg surface-2 border-veloxa-500/30 ring-1 ring-veloxa-500/20 flex items-center gap-2"
          >
            <span className="text-xs font-semibold text-ink-100">{selectedCount} selected</span>
            <div className="flex-1"/>
            <button onClick={handleBulkDuplicate} className="btn-ghost text-xs" title="Duplicate selected">
              <Copy className="w-3.5 h-3.5"/> Duplicate
            </button>
            <button onClick={handleBulkExport} className="btn-ghost text-xs" title="Export selected">
              <Download className="w-3.5 h-3.5"/> Export
            </button>
            <button onClick={handleBulkDelete} className="btn-ghost text-xs text-rose-400" title="Delete selected">
              <Trash2 className="w-3.5 h-3.5"/> Delete
            </button>
            <button onClick={clearSelectedProfiles} className="btn-ghost p-1 text-xs" title="Clear selection">
              <X className="w-3.5 h-3.5"/>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="px-3 pt-2 pb-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted pointer-events-none"/>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${profiles.length} profile${profiles.length === 1 ? '' : 's'}...`}
            className="input pl-8 pr-7 py-1.5 text-xs"
            data-search-input
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink-100"
              title="Clear"
            >
              <X className="w-3.5 h-3.5"/>
            </button>
          )}
        </div>
      </div>

      <div className={`overflow-auto p-2 space-y-1 ${compact ? 'max-h-[380px]' : 'min-h-0 flex-1'}`}>
        {profiles.length === 0 && (
          <div className="text-center py-8 px-4 space-y-3">
            <div className="text-sm font-medium text-ink-100">No profiles</div>
            <div className="text-xs text-muted leading-relaxed">
              You've deleted every profile. Create a new one to start watermarking.
            </div>
            <button
              onClick={() => startEditingProfile(null)}
              className="btn-primary text-xs mx-auto"
            >
              <Plus className="w-3.5 h-3.5"/> Create your first profile
            </button>
          </div>
        )}
        {profiles.length > 0 && filtered.length === 0 && (
          <div className="text-xs text-muted text-center py-8">
            No matches for <span className="text-ink-100">"{query}"</span>
          </div>
        )}
        {filtered.map((p) => {
          const TypeIcon = profileTypeIcon(p.type);
          const selected = p.id === selectedProfileId;
          const renaming = renamingId === p.id;
          const isMultiSelected = selectedProfileIdSet.has(p.id);
          return (
            <motion.div
              layout
              key={p.id}
              onClick={(e) => {
                if (renaming) return;
                // Ctrl/Cmd-click or Shift-click toggles multi-select
                if (e.ctrlKey || e.metaKey || e.shiftKey) {
                  toggleProfileSelected(p.id);
                } else {
                  setSelectedProfile(p.id);
                }
              }}
              className={`group cursor-pointer rounded-xl px-3 py-2.5 border transition-all ${
                isMultiSelected
                  ? 'border-veloxa-500 bg-veloxa-600/15 ring-1 ring-veloxa-500/40'
                  : selected
                    ? 'border-veloxa-500/60 bg-veloxa-600/10 shadow-glow'
                    : 'border-ink-600/40 hover:border-ink-500 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {/* Multi-select checkbox — visible on hover OR when any are selected */}
                <button
                  onClick={(e) => { e.stopPropagation(); toggleProfileSelected(p.id); }}
                  className={`shrink-0 transition-opacity ${
                    isMultiSelected || selectedCount > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title={isMultiSelected ? 'Deselect' : 'Select for bulk action'}
                >
                  {isMultiSelected
                    ? <CheckSquare className="w-4 h-4 text-veloxa-400"/>
                    : <Square className="w-4 h-4 text-ink-300"/>}
                </button>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                     style={{ background: p.fontColor ? `${p.fontColor}22` : '#3a60ff22', color: p.fontColor || '#5e87ff' }}>
                  <TypeIcon className="w-4 h-4"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {renaming ? (
                      <RenameInput
                        initial={p.name}
                        onCommit={(name) => handleRename(p.id, name)}
                        onCancel={() => setRenamingId(null)}
                      />
                    ) : (
                      <span
                        className="text-sm font-semibold truncate"
                        onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(p.id); }}
                        title="Double-click to rename"
                      >
                        {p.name}
                      </span>
                    )}
                    {p.isDefault && !renaming && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0"/>}
                  </div>
                  <div className="text-[11px] text-muted truncate">
                    {p.type === 'image' ? 'Logo watermark' : p.text || '—'}
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                  <button onClick={(e) => { e.stopPropagation(); startEditingProfile(p); }} className="btn-ghost p-1.5" title="Edit">
                    <Pencil className="w-3 h-3"/>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDuplicate(p.id); }} className="btn-ghost p-1.5" title="Duplicate">
                    <Copy className="w-3 h-3"/>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleSetDefault(p.id); }} className="btn-ghost p-1.5" title="Set default">
                    <Star className="w-3 h-3"/>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleExport(p.id); }} className="btn-ghost p-1.5" title="Export">
                    <Download className="w-3 h-3"/>
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }} className="btn-ghost p-1.5 text-rose-400" title="Delete">
                    <Trash2 className="w-3 h-3"/>
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function RenameInput({ initial, onCommit, onCancel }) {
  const [val, setVal] = useState(initial || '');
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); onCommit(val); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        e.stopPropagation();
      }}
      onBlur={() => onCommit(val)}
      onClick={(e) => e.stopPropagation()}
      className="input text-sm py-0.5 px-1.5 bg-ink-900/50 border-veloxa-500/60"
      maxLength={64}
    />
  );
}
