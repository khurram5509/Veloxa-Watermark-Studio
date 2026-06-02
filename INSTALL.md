# Installation Guide — Veloxa Watermark Studio

> **Current version: 2.4.1**

## System requirements

- **OS:** Windows 10 (1903+) or Windows 11
- **Architecture:** x64
- **Memory:** 4 GB RAM (8 GB+ recommended for large batches)
- **Disk:** ~290 MB for the unpacked app
- **Privileges:** Standard user — no admin rights required

### Optional dependency — Microsoft Office or LibreOffice (for PDF conversion)

The per-profile **Convert output to PDF** feature converts watermarked DOCX/PPTX outputs to PDF. Veloxa auto-detects two backends:

- **Microsoft Word + PowerPoint** (Windows-only, preferred). Detected via PowerShell COM automation. Most Windows users with Office installed get this for free — no extra install. Highest fidelity since Office files always render best in Office.
- **LibreOffice** (cross-platform fallback). [Download here](https://www.libreoffice.org/download/download/) (free, ~300 MB). Auto-detected from standard install paths and `$PATH`.

If neither is present, the toggle stays available but conversion is disabled with a clear status badge. Switch the preferred backend in **Settings → PDF export → Convert-to-PDF backend**.

---

## Option 1 — Installer (recommended)

1. Download `VeloxaWatermarkStudio-Setup-2.4.1.exe` (~85 MB) from the `release/` folder.
2. Double-click — the installer is a per-user install (no admin needed). The default location is `%LOCALAPPDATA%\Programs\Veloxa Watermark Studio`.
3. Pick whether you want a **Desktop** and / or **Start Menu** shortcut on the *Select Additional Tasks* page.
4. The installer registers an entry under **Settings → Apps → Installed apps → Veloxa Watermark Studio** so users can uninstall the regular Windows way.

Silent install (for IT deployment):
```
VeloxaWatermarkStudio-Setup-2.4.1.exe /VERYSILENT /NORESTART /SUPPRESSMSGBOXES /DIR="C:\Apps\Veloxa"
```

To uninstall: **Settings → Apps → Installed apps → Veloxa Watermark Studio → Uninstall**, or run `unins000.exe` from the install folder, or:
```
"%LOCALAPPDATA%\Programs\Veloxa Watermark Studio\unins000.exe" /VERYSILENT
```

---

## Option 2 — Portable (no install)

1. Download `VeloxaWatermarkStudio-Portable-2.4.1-win-x64.zip` from the `release/` folder.
2. Unzip it to any location (USB stick, network share, your Documents folder — anywhere writable).
3. Double-click `Veloxa Watermark Studio.exe` to launch.
4. Profiles, settings, logs, and the resumable queue state are stored under `%APPDATA%\Veloxa Watermark Studio\`.

**No installer, no admin rights, no registry changes** — the executable simply runs in place. You can move or copy the folder freely.

To uninstall, just delete the unzipped folder and (optionally) `%APPDATA%\Veloxa Watermark Studio\` for a full reset.

---

## Option 3 — Build from source

### Prerequisites
- **Node.js 20.x or 22.x LTS**
- **npm 10+**
- That's it — no native modules, no Visual Studio Build Tools required.

### Steps

```powershell
# Clone or unzip the source
cd "Veloxa Watermark Studio"

# Install dependencies (~561 packages, ~1 minute)
npm install

# Run in development with hot reload
npm run dev

# Build the renderer (Vite)
npm run build

# Package a portable Windows build
npx @electron/packager . "Veloxa Watermark Studio" `
  --platform=win32 --arch=x64 `
  --out=release --overwrite --asar

# Build the polished installer (.exe). Requires Inno Setup 6:
#   winget install --id JRSoftware.InnoSetup --silent --accept-package-agreements --accept-source-agreements
npm run installer
```

The packaged app appears in `release/Veloxa Watermark Studio-win32-x64/`. The installer (run via `npm run installer`) compiles to `release/VeloxaWatermarkStudio-Setup-<version>.exe` (~85 MB). Compress the packaged folder to a `.zip` for portable distribution:

```powershell
$version = (Get-Content package.json | ConvertFrom-Json).version
Compress-Archive -Path "release/Veloxa Watermark Studio-win32-x64" `
  -DestinationPath "release/VeloxaWatermarkStudio-Portable-$version-win-x64.zip" `
  -CompressionLevel Optimal -Force
```

---

## Verify the engine (optional)

A standalone smoke test runs all three processors and the worker pool against synthetic input:

```powershell
node scripts/smoke-engine.js
```

You should see `10/10 processors passed`.

---

## Optional: right-click context menu

After unzipping (or building) the app, run the included script — per-user, no admin needed:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-context-menu.ps1
```

This adds **"Process with Veloxa Watermark Studio"** to the right-click menu for `.pdf`, `.docx`, and `.pptx` files. To remove:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\register-context-menu.ps1 -Uninstall
```

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| **App won't start** | Check `%APPDATA%\Veloxa Watermark Studio\startup-error.log` |
| Drag-and-drop ignores files | Make sure they're `.pdf`, `.docx`, or `.pptx` — other types are silently skipped |
| DOCX watermark not visible | Requires Word 2007+ (LibreOffice and Word for Mac render it correctly) |
| PDF text shows as boxes | Standard PDF fonts are Latin-1 only; CJK / Arabic / Cyrillic / Devanagari needs a custom TTF (planned) |
| Job stuck mid-batch | Close the app — the queue auto-saves. On next launch, jobs marked **Interrupted** can be retried via `Ctrl+Shift+R` |
| Workers fail to spawn | See `startup-error.log`; usually means asar resolution failed and `engine/worker.js` needs unpacking via `--asar.unpack=engine/worker.js` |
| App won't start after move | The portable build expects to be in a writable location for cache |
| File-association doesn't work | Set defaults in **Windows Settings → Apps → Default apps** |
| PDF output is huge | Disable compression in **Settings → PDF export → Compression: None** only if needed; the default `standard` is already optimal |

---

## Uninstall / reset

- **Portable version:** delete the unzipped folder.
- **All data (profiles, settings, logs, queue):** delete `%APPDATA%\Veloxa Watermark Studio\`.
- **Right-click menu entry:** run the registration script with `-Uninstall`.

---

## Where things live

```
%APPDATA%\Veloxa Watermark Studio\
  ├── data\
  │   ├── profiles.json     # all watermark profiles
  │   ├── settings.json     # global settings
  │   ├── queue.json        # crash-safe queue snapshot (auto-resumes)
  │   ├── logs.jsonl        # rolling log buffer (last 2,000 lines)
  │   └── logos\            # logo images persisted on selection
  └── startup-error.log     # uncaught errors / failed loads
```

Logo images you pick or drop are copied into `data\logos\` (de-duped by content hash) so watermarks keep working even if you move or delete the source file.

Press `F1` inside the running app for the full Help & Shortcuts reference.
