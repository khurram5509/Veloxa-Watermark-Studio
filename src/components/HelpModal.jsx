import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, BookOpen, Download, LifeBuoy, ScrollText, Sparkles,
  ExternalLink, Keyboard,
} from 'lucide-react';
import { useStore } from '../store/useStore';

const TABS = [
  { id: 'quickstart', label: 'Quick Start',  icon: LifeBuoy },
  { id: 'shortcuts',  label: 'Shortcuts',    icon: Keyboard },
  { id: 'readme',     label: 'README',       icon: BookOpen },
  { id: 'install',    label: 'Installation', icon: Download },
  { id: 'license',    label: 'License',      icon: ScrollText },
];

export default function HelpModal({ open, onClose }) {
  const [tab, setTab] = useState('quickstart');
  const editingProfile = useStore((s) => s.editingProfile);
  const pendingFolderImport = useStore((s) => s.pendingFolderImport);

  // Esc closes Help — but only if no other modal is on top of us.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && !editingProfile && !pendingFolderImport) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, editingProfile, pendingFolderImport]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="help-backdrop"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="surface-1 rounded-2xl w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-ink-600/40">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-veloxa-400"/> Help & Documentation
              </h2>
              <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-4 h-4"/></button>
            </div>

            <div className="flex border-b border-ink-600/40">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`relative flex items-center gap-2 px-4 py-2.5 text-xs font-medium transition-colors ${
                      active ? 'text-white' : 'text-ink-100 hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5"/>
                    {t.label}
                    {active && (
                      <motion.span layoutId="help-tab-active"
                        className="absolute inset-x-2 bottom-0 h-0.5 bg-veloxa-500 rounded-full"/>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-auto px-6 py-5 text-sm leading-relaxed text-ink-100">
              {tab === 'quickstart' && <QuickStart/>}
              {tab === 'shortcuts' && <Shortcuts/>}
              {tab === 'readme' && <Readme/>}
              {tab === 'install' && <Install/>}
              {tab === 'license' && <License/>}
            </div>

            <div className="px-5 py-2.5 border-t border-ink-600/40 flex items-center justify-between text-[11px] text-muted">
              <span>Veloxa Watermark Studio · v2.4.1</span>
              <span>Press F12 anytime for renderer DevTools.</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function H({ children }) { return <h3 className="text-base font-semibold text-white mt-5 mb-2">{children}</h3>; }
function P({ children }) { return <p className="text-ink-100/90 mb-3">{children}</p>; }
function Code({ children }) { return <code className="px-1 py-0.5 rounded bg-ink-700/60 border border-ink-600/40 text-veloxa-300 text-[12px] font-mono">{children}</code>; }
function Pre({ children }) { return <pre className="bg-ink-900/80 border border-ink-600/40 rounded-lg p-3 text-[12px] font-mono overflow-x-auto mb-3 text-ink-100">{children}</pre>; }
function UL({ children }) { return <ul className="list-disc pl-5 space-y-1 mb-3 text-ink-100/90">{children}</ul>; }

function Kbd({ children }) {
  return (
    <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-ink-500/60 bg-ink-700/60 text-[11px] font-mono text-ink-100 shadow-sm">
      {children}
    </kbd>
  );
}

function Row({ keys, label }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-ink-600/30 last:border-b-0">
      <span className="text-[13px] text-ink-100">{label}</span>
      <span className="flex items-center gap-1 shrink-0">
        {keys.map((k, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-muted text-[11px] mx-0.5">+</span>}
            <Kbd>{k}</Kbd>
          </React.Fragment>
        ))}
      </span>
    </div>
  );
}

function Shortcuts() {
  return (
    <div>
      <H>Help</H>
      <div className="surface-2 rounded-lg px-4 py-1">
        <Row keys={['F1']} label="Open this Help & Documentation"/>
        <Row keys={['Ctrl', '/']} label="Open this Help (alternate)"/>
        <Row keys={['F12']} label="Toggle DevTools (renderer console)"/>
        <Row keys={['Ctrl', 'R']} label="Reload renderer"/>
      </div>

      <H>Navigation</H>
      <div className="surface-2 rounded-lg px-4 py-1">
        <Row keys={['Ctrl', '1']} label="Go to Dashboard"/>
        <Row keys={['Ctrl', '2']} label="Go to Profiles"/>
        <Row keys={['Ctrl', '3']} label="Go to Logs"/>
        <Row keys={['Ctrl', '4']} label="Go to Settings"/>
      </div>

      <H>Files & queue (Dashboard)</H>
      <div className="surface-2 rounded-lg px-4 py-1">
        <Row keys={['Ctrl', 'O']} label="Add files (open file picker)"/>
        <Row keys={['Ctrl', 'Shift', 'O']} label="Add folder (recursively scan)"/>
        <Row keys={['Ctrl', 'Enter']} label="PROCESS — start watermarking"/>
        <Row keys={['Ctrl', 'Space']} label="Pause / Resume queue"/>
        <Row keys={['Ctrl', '.']} label="Cancel running queue"/>
        <Row keys={['Ctrl', 'Shift', 'R']} label="Retry failed jobs"/>
        <Row keys={['Ctrl', 'Backspace']} label="Clear completed jobs from queue"/>
      </div>

      <H>Profile management</H>
      <div className="surface-2 rounded-lg px-4 py-1">
        <Row keys={['Ctrl', 'N']} label="New profile (opens editor)"/>
        <Row keys={['Ctrl', 'I']} label="Import profile from JSON"/>
        <Row keys={['F2']} label="Rename selected profile (Profiles tab)"/>
        <Row keys={['Delete']} label="Delete selected profile (Profiles tab)"/>
        <Row keys={['Ctrl', 'D']} label="Duplicate selected profile (Profiles tab)"/>
        <Row keys={['Enter']} label="Open selected profile in editor (Profiles tab)"/>
      </div>

      <H>Profile editor</H>
      <div className="surface-2 rounded-lg px-4 py-1">
        <Row keys={['Ctrl', 'S']} label="Save profile"/>
        <Row keys={['Ctrl', 'Z']} label="Undo last change"/>
        <Row keys={['Ctrl', 'Y']} label="Redo"/>
        <Row keys={['Ctrl', 'Shift', 'Z']} label="Redo (alternate)"/>
        <Row keys={['Esc']} label="Close (asks to confirm if there are unsaved changes)"/>
      </div>

      <p className="text-[11px] text-muted leading-relaxed mt-4">
        On macOS, swap <Kbd>Ctrl</Kbd> for <Kbd>⌘</Kbd>. Shortcuts that conflict with native browser
        actions in input fields (like <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> while typing) defer to the field.
      </p>
    </div>
  );
}

function QuickStart() {
  return (
    <div>
      <H>The 3-step workflow</H>
      <UL>
        <li><b>1. Drop</b> — drag PDF, DOCX, or PPTX files (or whole folders) onto the Dashboard. Folders are scanned recursively, and you'll get a <b>type-filter picker</b> to import only PDF / only DOCX / only PPTX or all of them. <Code>Ctrl+O</Code> opens the file picker, <Code>Ctrl+Shift+O</Code> picks a folder.</li>
        <li><b>2. Pick a profile</b> — the panel on the right lists profiles. Click one to select. Click <b>✎</b> for the full editor, double-click the name to rename inline, press <Code>F2</Code>, or hit <Code>Ctrl+N</Code> to create a new profile.</li>
        <li><b>3. PROCESS</b> — click the big PROCESS button (or <Code>Ctrl+Enter</Code>). Files are watermarked in parallel via real worker threads, originals are never touched, outputs are saved alongside the source (or to a custom folder).</li>
      </UL>

      <H>Profile editor essentials</H>
      <UL>
        <li><b>Type</b> — Text, Logo (PNG/JPG, source aspect ratio preserved), or Combined. <b>Logos are copied into the app's data folder</b> (<Code>%APPDATA%\Veloxa Watermark Studio\data\logos\</Code>) on selection — your watermark keeps working even if you move or delete the original file. The editor shows a green <i>Stored in app</i> badge once that's done.</li>
        <li><b>Position</b> — top-left / top-right / bottom-left / bottom-right / center / diagonal (auto-tilts to −30° on first pick if rotation is 0).</li>
        <li><b>Margin (pt)</b> — distance from the page edge for corner positions.</li>
        <li><b>Offset X/Y (pt)</b> — fine-tune the watermark from the chosen anchor. <b>+X = right, +Y = down</b>.</li>
        <li><b>Opacity / Rotation / Scale</b> — sliders. Live preview updates as you drag, at the actual destination canvas size (A4, Letter, Slide 16:9 / 4:3).</li>
        <li><b>Undo / Redo</b> — <Code>Ctrl+Z</Code> / <Code>Ctrl+Y</Code>. Up to 50 steps. Consecutive slider movements coalesce into one undo entry.</li>
        <li><b>Save with</b> <Code>Ctrl+S</Code>; <b>close with</b> <Code>Esc</Code> (asks before discarding unsaved changes).</li>
        <li><b>Pages</b> — All / First only / Last only / Custom range (e.g. <Code>1-3, 5, 8-10</Code>).</li>
        <li><b>Naming template</b> — tokens: <Code>{'{originalname}'}</Code> <Code>{'{counter}'}</Code> <Code>{'{date}'}</Code> <Code>{'{time}'}</Code> <Code>{'{profile}'}</Code> <Code>{'{ext}'}</Code></li>
      </UL>

      <H>Power features</H>
      <UL>
        <li><b>Convert output to PDF</b> — per-profile toggle. After watermarking, DOCX/PPTX outputs are converted to PDF. Two backends auto-detected: <b>Microsoft Word/PowerPoint</b> via COM automation (preferred — no extra install for Office users) and <b>LibreOffice</b> (cross-platform fallback). Backend preference is configurable in Settings.</li>
        <li><b>True parallelism</b> — jobs run on real OS worker threads. Set the pool size in <i>Settings → Performance → Max concurrent jobs</i>.</li>
        <li><b>Crash-safe queue with resume banner</b> — the queue is persisted to disk on every change. If the app is killed mid-batch, jobs are restored on next launch and a banner offers <b>Resume</b> / <b>Discard</b>.</li>
        <li><b>Profile validation</b> before each run — flags missing logo files, empty text, invalid page ranges, etc.</li>
        <li><b>Watermark conflict detection</b> — DOCX/PPTX files already carrying a Veloxa watermark are auto-skipped (toggle in <i>Settings → Conflict detection</i>).</li>
        <li><b>Logo library</b> — <i>Browse</i> picks new logos from disk; <i>Library</i> reuses any logo already saved to the app folder.</li>
        <li><b>Recent profiles</b> — most-recently-used profiles appear as quick-pick chips above the Dashboard queue.</li>
        <li><b>Bulk profile actions</b> — <Code>Ctrl</Code>-click profiles to multi-select, then <b>Delete / Duplicate / Export</b> them all at once.</li>
        <li><b>Window state persistence</b> — Veloxa remembers your window position, size, and maximize state.</li>
        <li><b>Confirm-before-close</b> — warns if there are pending jobs OR unsaved profile changes when you try to quit.</li>
        <li><b>Drag-drop on the Profiles tab</b> — drop a PNG/JPG to set as the logo on the selected profile (opens the editor pre-filled), drop a JSON to import a profile.</li>
        <li><b>Profile search</b> — filter by name or watermark text from the search box at the top of the Profiles list.</li>
        <li><b>HTTP backend</b> — run <Code>npm run server</Code> to start a local REST API at <Code>http://127.0.0.1:4719</Code> for scripted / headless watermarking. See README for endpoints.</li>
        <li><b>Keyboard shortcuts</b> — see the Shortcuts tab. <Code>F1</Code> opens this Help anywhere.</li>
      </UL>

      <H>Tips</H>
      <UL>
        <li>Outputs <b>never overwrite originals</b> — duplicate filenames get an auto-incremented suffix.</li>
        <li>The <Code>{'{counter}'}</Code> naming token <b>restarts at the value in Settings → Output → "Counter starts at"</b> for every new batch (each click of PROCESS that starts an idle queue). Files added to a still-running queue continue the same batch's counter. Add <Code>{'{date}'}</Code> or <Code>{'{time}'}</Code> to your template if you want batch-to-batch uniqueness.</li>
        <li>Set a profile as <b>default</b> with the ★ to apply it automatically on every run.</li>
        <li><b>Pause / Resume</b> with <Code>Ctrl+Space</Code>; <b>Retry failed</b> with <Code>Ctrl+Shift+R</Code>; <b>Cancel</b> with <Code>Ctrl+.</Code></li>
        <li>Press <Code>F12</Code> to open the renderer DevTools console; main-process errors land in <Code>%APPDATA%\Veloxa Watermark Studio\startup-error.log</Code>.</li>
      </UL>
    </div>
  );
}

function Readme() {
  return (
    <div>
      <H>Veloxa Watermark Studio</H>
      <P>Premium offline desktop tool for unattended bulk watermarking of PDF, DOCX, and PPTX files. Drop in files or whole folders, pick a profile, click PROCESS — Veloxa scans, watermarks, and writes outputs in parallel without ever touching the originals.</P>

      <H>Highlights</H>
      <UL>
        <li>Drag-and-drop bulk workflow — files OR entire folders (recursive)</li>
        <li>Three formats — PDF (pdf-lib), DOCX (VML watermark layer in headers, multi-section aware), PPTX (slide-shape injection)</li>
        <li>Profile system — text / logo / combined, opacity, rotation, scale, position, margin, X/Y offset, page targeting, naming templates, image aspect-ratio preserved</li>
        <li><b>True multi-threaded queue</b> — long-lived <Code>worker_threads</Code> pool sized to <i>maxConcurrent</i>; pause/resume, retry-failed, live progress</li>
        <li><b>Crash-safe queue</b> — every state change is persisted; jobs in-flight at exit are restored as <i>Interrupted</i> on next launch for one-click retry</li>
        <li>Live preview at the destination canvas (A4 / Letter / Slide 16:9 / Slide 4:3, portrait + landscape)</li>
        <li>Undo / Redo in the profile editor (50 levels, smart coalescing)</li>
        <li>Profile search, inline rename (double-click or <Code>F2</Code>), drop-to-set-logo</li>
        <li>Comprehensive keyboard shortcuts — see the Shortcuts tab</li>
        <li>Native Windows integration — taskbar progress, toast notifications, file associations, optional context-menu entry</li>
        <li>Original files untouched — outputs renamed, saved alongside or to a custom folder; never overwritten</li>
        <li>Fully offline — no telemetry, all data in <Code>%APPDATA%\Veloxa Watermark Studio</Code></li>
      </UL>

      <H>Tech stack</H>
      <UL>
        <li>Electron 33 + React 18 + Tailwind CSS + Framer Motion + Lucide icons</li>
        <li>State: Zustand · PDF: pdf-lib · DOCX/PPTX: pizzip + custom OOXML injection</li>
        <li>Worker pool: <Code>node:worker_threads</Code> with N pre-spawned workers, dynamic resize, automatic respawn on crash</li>
        <li>Storage: plain JSON files in <Code>app.getPath('userData')</Code></li>
        <li>Bundler: Vite · Packager: <Code>@electron/packager</Code></li>
      </UL>

      <H>How watermarking works</H>
      <UL>
        <li><b>PDF</b> — pdf-lib opens the document, embeds a Standard Type 1 font (Helvetica/Times/Courier mapped from the profile's font family) and an optional PNG/JPG logo, then draws a transparent text/image layer on each targeted page with rotation, opacity, color, and X/Y offset.</li>
        <li><b>DOCX</b> — pizzip unpacks the file, a VML watermark shape (the same technique Word uses for "Insert → Watermark") is written into a new header part wired into <i>every</i> <Code>w:sectPr</Code> (multi-section aware, self-closing tags handled), and the content-types manifest is updated.</li>
        <li><b>PPTX</b> — pizzip unpacks the file, slide dimensions are read from <Code>presentation.xml</Code>, and a watermark <Code>p:sp</Code> (text) and/or <Code>p:pic</Code> (image, with <Code>alphaModFix</Code>) is appended to every targeted slide's <Code>spTree</Code>. Image aspect ratio is preserved by reading the source PNG/JPG header.</li>
      </UL>

      <H>Where things live</H>
      <Pre>{`%APPDATA%\\Veloxa Watermark Studio\\
  ├── data\\
  │   ├── profiles.json     # all watermark profiles
  │   ├── settings.json     # global settings
  │   ├── queue.json        # crash-safe queue snapshot
  │   ├── logs.jsonl        # rolling log buffer (last 2,000 lines)
  │   └── logos\\           # logo images copied here on selection,
  │                         #   so watermarks survive the user moving
  │                         #   or deleting the source file
  └── startup-error.log     # uncaught errors / failed loads`}</Pre>
      <P>Delete the folder to fully reset the app.</P>
    </div>
  );
}

function Install() {
  return (
    <div>
      <H>System requirements</H>
      <UL>
        <li>Windows 10 (1903+) or Windows 11</li>
        <li>x64 architecture</li>
        <li>4 GB RAM (8 GB+ recommended for large batches)</li>
        <li>~290 MB disk for the unpacked app</li>
      </UL>

      <H>Option 1 — Installer (recommended)</H>
      <UL>
        <li>Download <Code>VeloxaWatermarkStudio-Setup-2.4.1.exe</Code> (~85 MB) and double-click.</li>
        <li>Per-user install — no admin rights needed. Default location: <Code>%LOCALAPPDATA%\Programs\Veloxa Watermark Studio</Code>.</li>
        <li>Pick whether you want a <b>Desktop</b> and / or <b>Start Menu</b> shortcut on the <i>Select Additional Tasks</i> page.</li>
        <li>Uninstalls the regular Windows way: <b>Settings → Apps → Installed apps → Veloxa Watermark Studio → Uninstall</b>.</li>
        <li>Silent install for IT deployment: <Code>Setup.exe /VERYSILENT /NORESTART /SUPPRESSMSGBOXES /DIR="C:\Apps\Veloxa"</Code></li>
      </UL>

      <H>Option 2 — Portable (no install)</H>
      <UL>
        <li>Unzip <Code>VeloxaWatermarkStudio-Portable-2.4.1-win-x64.zip</Code> to any folder (USB stick, network share, anywhere).</li>
        <li>Double-click <Code>Veloxa Watermark Studio.exe</Code> — no install required, no admin rights, no registry changes.</li>
        <li>Profiles, settings, logs, and the resumable queue are stored in <Code>%APPDATA%\Veloxa Watermark Studio</Code>.</li>
        <li>To reset, just delete that folder.</li>
      </UL>

      <H>Option 3 — Build from source</H>
      <P>Prerequisites: Node.js 20.x or 22.x LTS, npm 10+.</P>
      <Pre>{`# Install dependencies
npm install

# Run in development (hot reload)
npm run dev

# Build the renderer (Vite)
npm run build

# Package the Windows portable build
npx @electron/packager . "Veloxa Watermark Studio" \\
  --platform=win32 --arch=x64 \\
  --out=release --overwrite --asar`}</Pre>
      <P>Output lands in <Code>release/Veloxa Watermark Studio-win32-x64/</Code>. Zip the folder for distribution.</P>

      <H>Right-click context menu (optional)</H>
      <P>After unzipping, run the included script (per-user, no admin needed):</P>
      <Pre>{`powershell -ExecutionPolicy Bypass \\
  -File scripts\\register-context-menu.ps1`}</Pre>
      <P>Adds <b>"Process with Veloxa Watermark Studio"</b> to the right-click menu for PDF, DOCX, and PPTX files. Pass <Code>-Uninstall</Code> to remove.</P>

      <H>Troubleshooting</H>
      <UL>
        <li><b>App won't start</b> → check <Code>%APPDATA%\Veloxa Watermark Studio\startup-error.log</Code></li>
        <li><b>Drag-and-drop ignores files</b> → make sure they're <Code>.pdf</Code>, <Code>.docx</Code>, or <Code>.pptx</Code> (other types are silently skipped)</li>
        <li><b>DOCX watermark not visible</b> → requires Word 2007+ (LibreOffice and Word for Mac render it correctly)</li>
        <li><b>PDF text shows as boxes</b> → Standard PDF fonts are Latin-1 only; non-Latin (CJK / Arabic / Cyrillic / Devanagari) text needs a custom TrueType font (planned)</li>
        <li><b>Job stuck mid-batch</b> → close the app; the queue auto-saves. On next launch, jobs marked <i>Interrupted</i> can be retried via <Code>Ctrl+Shift+R</Code></li>
        <li><b>Workers fail to spawn</b> → see <Code>startup-error.log</Code>; usually means asar resolution failed and the file needs unpacking</li>
        <li><b>To reset all data</b> → delete the <Code>%APPDATA%\Veloxa Watermark Studio</Code> folder</li>
      </UL>
    </div>
  );
}

function License() {
  return (
    <div>
      <H>License</H>
      <P><b>Veloxa Watermark Studio v2.4.1</b></P>
      <P>Copyright © 2026 Veloxa. All rights reserved.</P>

      <H>Terms</H>
      <P>This software is provided as-is. You may install and use it on as many machines as needed for personal or business document watermarking. Redistribution of the binaries, the source code, or the build artifacts requires written permission.</P>
      <P>The watermarking engine processes documents entirely on-device. No data, telemetry, or document content is transmitted off the user's machine.</P>

      <H>Third-party components</H>
      <UL>
        <li><b>Electron</b> — MIT License — <ExternalLink className="inline w-3 h-3 align-middle"/> electronjs.org</li>
        <li><b>React</b> — MIT License</li>
        <li><b>Tailwind CSS</b> — MIT License</li>
        <li><b>Framer Motion</b> — MIT License</li>
        <li><b>Lucide</b> (icons) — ISC License</li>
        <li><b>Zustand</b> — MIT License</li>
        <li><b>pdf-lib</b> — MIT License</li>
        <li><b>PizZip</b> — MIT License</li>
        <li>14 PDF Standard Fonts — Adobe Type 1 specification (royalty-free)</li>
      </UL>
      <P>Full license texts are bundled with the app distribution under <Code>LICENSES.chromium.html</Code> and the respective <Code>node_modules/*/LICENSE</Code> files.</P>

      <H>Disclaimer</H>
      <P>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY ARISING FROM, OUT OF, OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</P>
    </div>
  );
}
