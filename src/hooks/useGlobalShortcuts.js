import { useEffect } from 'react';
import { useStore } from '../store/useStore';

/**
 * Centralized keyboard shortcut dispatcher.
 *
 * Mounted once at the top of the App. Reads store state via getState() inside
 * the handler so the listener isn't re-bound on every render.
 *
 * Per-modal shortcuts (Esc, Ctrl+Z/Y/S in ProfileEditor; Esc in HelpModal) live
 * with their respective components so focus and dirty-state checks stay local.
 */
export function useGlobalShortcuts({ onProcess }) {
  useEffect(() => {
    const handler = (e) => {
      const v = typeof window !== 'undefined' ? window.veloxa : null;
      const s = useStore.getState();
      const meta = e.ctrlKey || e.metaKey;
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);

      // ── Always-on shortcuts ─────────────────────────────────────────
      // F1 → open Help (works anywhere — even while typing)
      if (e.key === 'F1') {
        e.preventDefault();
        s.openHelp();
        return;
      }

      // If a modal is on top, swallow the rest. (HelpModal / ProfileEditor /
      // FolderImportModal own their own Esc handlers.)
      if (s.editingProfile || s.helpOpen || s.pendingFolderImport) return;

      // From this point on, every shortcut must NOT fire while the user is
      // typing in an input field — otherwise Ctrl+Backspace eats words from
      // the search box, Ctrl+I overrides "italic", Ctrl+N steals from forms,
      // Enter triggers profile-edit while typing into the search box, etc.
      if (inField) return;

      // Ctrl+/ or Ctrl+? → open Help (skipped in inputs since Ctrl+/ is
      // commonly "comment line" muscle-memory in editors)
      if (meta && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        s.openHelp();
        return;
      }

      // ── Navigation: Ctrl+1..4 ──────────────────────────────────────
      if (meta && !e.shiftKey && !e.altKey && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        const views = ['dashboard', 'profiles', 'logs', 'settings'];
        s.setView(views[parseInt(e.key, 10) - 1]);
        return;
      }

      // ── File operations (Dashboard) ────────────────────────────────
      // Ctrl+O → Add files (explicit selection, skip the type-filter picker)
      if (meta && (e.key === 'o' || e.key === 'O') && !e.shiftKey) {
        e.preventDefault();
        if (v?.app?.pickFiles) {
          v.app.pickFiles().then(async (paths) => {
            if (paths?.length) {
              const scan = await v.scan.paths(paths);
              if (scan?.files?.length) s.addPendingFiles(scan.files);
            }
          });
        }
        return;
      }
      // Ctrl+Shift+O → Add folder (always show the type-filter picker)
      if (meta && e.shiftKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        if (v?.app?.pickFolder) {
          v.app.pickFolder().then(async (dir) => {
            if (dir) {
              const scan = await v.scan.paths([dir]);
              if (scan) s.showFolderImport(scan);
            }
          });
        }
        return;
      }

      // ── Process / queue control ────────────────────────────────────
      // Ctrl+Enter → PROCESS
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        onProcess?.();
        return;
      }
      // Ctrl+Space → Pause/Resume
      if (meta && e.key === ' ') {
        if (s.queue.running) {
          e.preventDefault();
          if (s.queue.paused) v?.engine.resume();
          else v?.engine.pause();
        }
        return;
      }
      // Ctrl+. → Cancel
      if (meta && e.key === '.') {
        if (s.queue.running) {
          e.preventDefault();
          v?.engine.cancel();
        }
        return;
      }
      // Ctrl+Shift+R → Retry failed
      if (meta && e.shiftKey && (e.key === 'R' || e.key === 'r')) {
        e.preventDefault();
        v?.engine.retryFailed();
        return;
      }
      // Ctrl+Backspace → Clear completed
      if (meta && e.key === 'Backspace') {
        e.preventDefault();
        v?.engine.clearCompleted();
        return;
      }

      // ── Profile management ─────────────────────────────────────────
      // Ctrl+N → New profile (jumps to Profiles tab + opens editor)
      if (meta && (e.key === 'n' || e.key === 'N') && !e.shiftKey) {
        e.preventDefault();
        s.setView('profiles');
        s.startEditingProfile(null);
        return;
      }
      // Ctrl+I → Import profile
      if (meta && (e.key === 'i' || e.key === 'I') && !e.shiftKey) {
        e.preventDefault();
        v?.profiles.import().then(() => s.loadProfiles());
        return;
      }

      // ── Profiles tab — selection-scoped shortcuts ──────────────────
      if (s.view === 'profiles' && s.selectedProfileId && !inField) {
        // F2 → Rename
        if (e.key === 'F2') {
          e.preventDefault();
          s.setRenamingProfileId(s.selectedProfileId);
          return;
        }
        // Delete → Delete
        if (e.key === 'Delete') {
          e.preventDefault();
          if (window.confirm('Delete this profile?')) {
            v?.profiles.delete(s.selectedProfileId).then(() => s.loadProfiles());
          }
          return;
        }
        // Ctrl+D → Duplicate
        if (meta && (e.key === 'd' || e.key === 'D')) {
          e.preventDefault();
          v?.profiles.duplicate(s.selectedProfileId).then(() => s.loadProfiles());
          return;
        }
        // Enter → Open editor
        if (e.key === 'Enter') {
          e.preventDefault();
          const p = s.profiles.find((x) => x.id === s.selectedProfileId);
          if (p) s.startEditingProfile(p);
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // intentionally empty deps — handler reads state via getState()
  }, [onProcess]);
}
