Build resources for electron-builder.

Required files for Windows packaging:
- icon.ico  → 256×256 multi-resolution icon used by the installer and the EXE.
- icon.png  → 512×512 PNG used by the in-app tray.

Drop your branded assets here before running:
  npm run dist:installer
  npm run dist:portable
