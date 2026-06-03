# Veloxa Watermark Studio

**Automated bulk document watermarking for Windows 10 / 11.**

A premium, offline desktop tool for unattended bulk watermarking of PDF, DOCX, and PPTX files. Drag in files or entire folders, pick a profile, hit **PROCESS** — Veloxa scans, watermarks, and writes the outputs in parallel via real worker threads, without ever touching the originals.

> **Current version: 2.6.1** — branded installer icon + app exe icon (was missing on every prior build).

## Download

Latest installer: **[VeloxaWatermarkStudio-Setup-2.6.1.exe](https://github.com/khurram5509/Veloxa-Watermark-Studio/releases/latest)** (81.8 MB, Windows 10/11 x64, per-user install — no admin rights needed).

The app checks for new versions automatically once per day (silently — no "you're up to date" toast every launch). You can trigger a manual check or disable auto-checks from **Settings → Updates**.

---

## Highlights

- **Drag-and-drop bulk workflow** — drop files OR entire folders (recursive). Folders trigger a **type-filter picker** so you can import only PDF, only DOCX, only PPTX, or any combination
- **Folder type-filter picker** — when scanning a folder, pick which file types to import (PDF / DOCX / PPTX / all) before they hit the queue
- **Convert output to PDF** (per-profile) — after watermarking, DOCX/PPTX outputs are auto-converted to PDF. Two backends auto-detected: **Microsoft Word/PowerPoint** via COM (preferred, no extra install for Office users) and **LibreOffice** (cross-platform fallback). Backend selection configurable in Settings.
- **Output quality** (per-profile) — pick `standard` (smaller files, JPEG q75 / 150 DPI) or `high` (lossless / full-DPI / print quality) for converted PDFs. Wired through both Office's `ExportAsFixedFormat OptimizeFor` flag and LibreOffice's `writer_pdf_Export` filter args.
- **Three formats** — PDF (`pdf-lib`), DOCX (VML watermark layer in headers, multi-section aware), PPTX (slide-shape injection)
- **Profile system** — text / logo / combined, opacity, rotation, scale, position, margin, X/Y offset, page targeting, naming templates, image aspect-ratio preserved
- **True parallelism** — `worker_threads` pool sized to `maxConcurrent`, with dynamic resize and crash-respawn
- **Crash-safe queue** — every state change persisted; in-flight jobs at exit are restored as `Interrupted` for one-click retry on next launch
- **Live preview** at the actual destination canvas (A4 / Letter / Slide 16:9 / Slide 4:3, portrait + landscape)
- **Undo / Redo** in the profile editor (50 levels, smart slider coalescing)
- **Profile search**, inline rename (double-click or `F2`), drop-to-set-logo on the Profiles tab
- **Comprehensive keyboard shortcuts** — see in-app Help → Shortcuts (`F1`)
- **Native Windows integration** — taskbar progress bar, toast notifications, file-association launching, optional context-menu entry
- **Confirm-before-close** when the queue or editor has unsaved work
- **Original files untouched** — outputs always renamed and saved alongside (or to a custom folder)
- **Fully offline** — no telemetry, no cloud, all data stored locally in `%APPDATA%\Veloxa Watermark Studio\`

---

## Tech stack

| Layer | Tech |
| --- | --- |
| Shell | Electron 33 |
| UI | React 18 + Tailwind CSS + Framer Motion + Lucide icons |
| State | Zustand |
| PDF | `pdf-lib` |
| DOCX / PPTX | `pizzip` + custom OOXML injection |
| Workers | `node:worker_threads` pool (engine/workerPool.js) |
| Storage | Plain JSON files in `app.getPath('userData')` |
| Bundler | Vite |
| Packager | `@electron/packager` (portable EXE) |

---

## Project structure

```
veloxa-watermark-studio/
├── electron/             # Electron main + preload + IPC bridge
│   ├── main.js
│   ├── preload.js
│   └── ipc-handlers.js
├── engine/               # Headless watermarking engine (Node only)
│   ├── processors/       # pdf.js, docx.js, pptx.js, ooxml.js, index.js
│   ├── queue.js          # queue + events + crash-safe persistence
│   ├── workerPool.js     # worker_threads pool manager
│   ├── worker.js         # worker entry — loads processors, processes jobs
│   ├── queueState.js     # debounced disk persistence for the queue
│   ├── profiles.js       # CRUD over profiles.json
│   ├── settings.js       # CRUD over settings.json
│   ├── scanner.js        # recursive folder walker
│   ├── naming.js         # template token resolution
│   ├── logger.js         # structured log buffer + JSONL persistence
│   └── paths.js          # userData path helpers
├── src/                  # React renderer
│   ├── components/       # TitleBar, Sidebar, DropZone, QueuePanel,
│   │                     #   ProfilesPanel, ProfileEditor, LogsPanel,
│   │                     #   SettingsPanel, StatCard, HelpModal
│   ├── hooks/
│   │   └── useGlobalShortcuts.js   # central keyboard shortcut dispatcher
│   ├── store/useStore.js # Zustand global store
│   ├── utils/format.js
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── scripts/
│   ├── smoke-engine.js              # standalone engine smoke test
│   └── register-context-menu.ps1    # optional shell extension
├── build/                # icons + packaging resources
├── index.html
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

---

## Getting started

```powershell
# 1. Install dependencies
npm install

# 2. Run in dev (Vite + Electron with hot reload)
npm run dev
```

The dev script starts Vite on port 5173 and launches Electron once the renderer is ready.

### Build & package

```powershell
# Build the renderer only
npm run build

# Package the Windows portable build
npx @electron/packager . "Veloxa Watermark Studio" `
  --platform=win32 --arch=x64 `
  --out=release --overwrite --asar

# Build the polished Windows installer (~85 MB single .exe). Requires Inno Setup 6.
# Auto-installed once via:
#   winget install --id JRSoftware.InnoSetup --silent --accept-package-agreements --accept-source-agreements
npm run installer
```

Output:
- Portable: `release/Veloxa Watermark Studio-win32-x64/Veloxa Watermark Studio.exe` (run-in-place)
- Installer: `release/VeloxaWatermarkStudio-Setup-<version>.exe` (per-user install with Start Menu / Desktop shortcuts and an Add-or-Remove-Programs entry)

> **Icons:** drop `build/icon.ico` (256×256 multi-res) and `build/icon.png` before packaging. See `build/README.txt`.

---

## How watermarking works

| Format | Approach |
| --- | --- |
| **PDF** | `pdf-lib` opens the document, embeds a Standard Type 1 font (Helvetica / Times / Courier — mapped from the profile's font family) and an optional PNG/JPG logo, then draws a transparent text/image layer on each targeted page with rotation, opacity, color, X/Y offset, and source-aspect-ratio-preserving scaling. |
| **DOCX** | The DOCX is unzipped with PizZip; a VML-based watermark shape (the same technique Word uses for "Insert → Watermark") is written into a new header part. The header part is wired into **every** existing `<w:sectPr>` (multi-section aware) including self-closing variants, and `[Content_Types].xml` is updated. Renders identically in Word 2007+ and LibreOffice. |
| **PPTX** | The presentation is unzipped, slide dimensions are read from `presentation.xml`, and a watermark `<p:sp>` (text) and/or `<p:pic>` (image, with `alphaModFix` for opacity) is appended to every targeted slide's `<p:spTree>`. Image relationships are written into per-slide `_rels` files. Source image aspect ratio is preserved by parsing the PNG IHDR / JPEG SOFn header directly. |

All three processors run inside the worker pool (`engine/workerPool.js`) — **real OS threads, real parallelism**, dynamically sized to the `maxConcurrent` setting.

---

## Default profiles

Veloxa ships with four starter profiles: **Company Confidential**, **Draft Version**, **Internal Distribution**, and **Approved Copy**. Edit them, duplicate them, or build your own from scratch in the Profile editor. If you delete every profile, the starters are auto-reseeded on next load to keep you out of a stuck state.

### Naming template tokens

| Token | Replaces with |
| --- | --- |
| `{originalname}` | Source filename without extension |
| `{counter}` | Zero-padded counter (padding configurable) |
| `{date}` | `YYYYMMDD` |
| `{time}` | `HHMMSS` |
| `{profile}` | Profile name (sanitized) |
| `{ext}` | Extension without the dot |

Examples:
```
{originalname}_WM_{counter}            → Report_WM_001.pdf
{originalname}_{profile}               → Report_Company_Confidential.pdf
{originalname}_{date}                  → Report_20260507.pdf
```

> The `{counter}` restarts from `Settings → Output → "Counter starts at"` for **every batch** — each click of PROCESS that starts an idle queue. Files added to a still-running queue continue the existing batch's counter. Use `{date}` or `{time}` in your template if you need uniqueness across batches.

---

## Keyboard shortcuts

Press `F1` (or `Ctrl + /`) inside the app for the full list. Highlights:

| Keys | Action |
| --- | --- |
| `F1` | Open Help & Documentation |
| `Ctrl + 1..4` | Switch tabs (Dashboard / Profiles / Logs / Settings) |
| `Ctrl + O` / `Ctrl + Shift + O` | Add files / Add folder |
| `Ctrl + Enter` | PROCESS |
| `Ctrl + Space` / `Ctrl + .` | Pause-Resume / Cancel |
| `Ctrl + Shift + R` | Retry failed |
| `Ctrl + Backspace` | Clear completed |
| `Ctrl + N` / `Ctrl + I` | New profile / Import profile |
| `F2` / `Delete` / `Ctrl + D` | Rename / Delete / Duplicate selected profile |
| `Ctrl + S` / `Ctrl + Z` / `Ctrl + Y` | Save / Undo / Redo (in editor) |

---

## Windows integration

- **Taskbar progress** — the icon fills as the queue processes.
- **Toast notifications** — fired at the end of each run.
- **File associations** — opening a `.pdf`/`.docx`/`.pptx` with Veloxa enqueues it (single-instance reuse).
- **Context menu** — run `scripts/register-context-menu.ps1` to add a "Process with Veloxa Watermark Studio" entry.
- **Single instance** — opening files via Explorer reuses the running window and enqueues them.

---

## Data locations

Everything stays on disk. No cloud syncing.

```
%APPDATA%\Veloxa Watermark Studio\
  ├── data\
  │   ├── profiles.json     # all watermark profiles
  │   ├── settings.json     # global settings
  │   ├── queue.json        # crash-safe queue snapshot
  │   ├── logs.jsonl        # rolling log buffer (last 2,000 lines)
  │   └── logos\            # logo images copied here on selection
  └── startup-error.log     # uncaught errors / failed loads
```

Logos are copied into `logos/` (de-duped by content hash) when you pick or drop one, so watermarks keep working even if you move or delete the source file.

Delete the folder to fully reset the app.

---

## Verifying the engine

A standalone smoke test exercises every processor + the worker pool against generated input files:

```powershell
node scripts/smoke-engine.js
```

Expected output:
```
✔ Image-size reader — PNG 3×7 detected correctly
✔ PDF font mapping — Times family embedded when fontFamily="Times New Roman"
✔ PDF processor — output 1909 bytes, 3 pages
✔ DOCX processor — position/offset honored
✔ DOCX multi-section — headerRef injected into both sectPr
✔ DOCX XML escaping — special chars correctly escaped
✔ PPTX multi-slide + custom range — non-targeted slides skipped
✔ PPTX processor — position + offset honored
✔ Worker pool — 6 jobs across 3 workers
✔ Worker pool — resize down to 2 workers OK

10/10 processors passed
```

---

## HTTP backend

Veloxa ships with a standalone REST API server that exposes the same engine (workers, profiles, queue) without the GUI. Run it for headless / CI / scripted use:

```powershell
npm run server
# Veloxa Watermark Studio · backend
#   version  : v2.4.1
#   listening: http://127.0.0.1:4719
#   profiles : 4
```

Override host/port with `VELOXA_HOST` / `VELOXA_PORT` env vars. Bound to `127.0.0.1` by default — local-only.

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | health + version + worker pool stats |
| `GET /api/version` | just the version |
| `GET /api/profiles` · `POST /api/profiles` | list / create |
| `GET /api/profiles/:id` · `PUT /api/profiles/:id` · `DELETE /api/profiles/:id` | per-profile CRUD |
| `GET /api/settings` · `PATCH /api/settings` | read / partial-update settings |
| `POST /api/scan` `{path}` or `{paths:[]}` | recursive folder scan, returns `{files,hadFolder,byType}` |
| `POST /api/validate` `{profile|profileId}` | validate without processing |
| `POST /api/watermark` `{input,profile|profileId,output?}` | watermark one file synchronously |
| `POST /api/watermark/batch` `{inputs:[]\|folder, profile|profileId, timeoutMs?}` | enqueue + process via worker pool, waits for completion |
| `GET /api/queue` | live queue state |
| `POST /api/queue/clear` | clear all jobs |

Example — watermark a single file:

```bash
curl -X POST http://127.0.0.1:4719/api/watermark \
  -H 'Content-Type: application/json' \
  -d '{"input":"C:\\\\reports\\\\Q4.pdf","profileId":"company-confidential"}'
```

Engine modules (paths, profiles, settings, queue, validation) auto-detect they're running outside Electron and fall back to the OS conventional per-user data location, so the backend reads/writes the same data files the desktop app uses.

---

## License

Proprietary © 2026 Veloxa. See in-app Help → License for full terms and third-party attribution.
