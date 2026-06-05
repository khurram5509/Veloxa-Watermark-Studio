#!/usr/bin/env bash
# Veloxa Watermark Studio — macOS one-shot installer / assembler.
#
# This script runs on the user's Mac and assembles a runnable .app bundle
# from the pieces shipped in the .tar.gz next to it:
#   - app.asar     (the actual Veloxa app code — built on Windows)
#   - build/icon.icns (the app icon)
#   - this script
#
# It downloads the matching Electron-darwin runtime from the official CDN
# (preserving the framework symlinks that Windows hosts can't create) and
# stitches them together. The result is a Veloxa Watermark Studio.app you
# can move to /Applications and launch normally.
#
# Usage (from the directory containing this script + app.asar + build/icon.icns):
#   bash veloxa-mac-installer.sh
#
# Optional flags:
#   --arch=x64|arm64   Override auto-detection (defaults to your Mac's CPU)
#   --keep-runtime     Don't delete the downloaded Electron zip after extract
#
# Requires curl, unzip, and an internet connection on first run. Subsequent
# runs reuse the cached runtime in ~/Library/Caches/veloxa-electron/.

set -euo pipefail

# --- Configuration --------------------------------------------------------

ELECTRON_VERSION="33.4.11"          # keep in lockstep with package.json devDeps
APP_NAME="Veloxa Watermark Studio"
APP_BUNDLE_ID="app.veloxa.watermarkstudio"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_CACHE="${HOME}/Library/Caches/veloxa-electron"
OUT_APP="${APP_DIR}/${APP_NAME}.app"

# --- Parse args -----------------------------------------------------------

ARCH_OVERRIDE=""
KEEP_RUNTIME=0
for arg in "$@"; do
  case "$arg" in
    --arch=*)     ARCH_OVERRIDE="${arg#--arch=}" ;;
    --keep-runtime) KEEP_RUNTIME=1 ;;
    -h|--help)
      grep -E '^#' "$0" | sed -E 's/^# ?//'; exit 0 ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# --- Detect Mac arch ------------------------------------------------------

if [[ -n "${ARCH_OVERRIDE}" ]]; then
  MAC_ARCH="${ARCH_OVERRIDE}"
else
  case "$(uname -m)" in
    arm64) MAC_ARCH="arm64" ;;
    x86_64) MAC_ARCH="x64" ;;
    *) echo "Unsupported Mac arch: $(uname -m)"; exit 1 ;;
  esac
fi

ELECTRON_FILE="electron-v${ELECTRON_VERSION}-darwin-${MAC_ARCH}.zip"
ELECTRON_URL="https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${ELECTRON_FILE}"
CACHED_ZIP="${RUNTIME_CACHE}/${ELECTRON_FILE}"

echo "▸ Mac arch:     ${MAC_ARCH}"
echo "▸ Electron:     v${ELECTRON_VERSION}"
echo "▸ Output:       ${OUT_APP}"

# --- Sanity check shipped pieces ------------------------------------------

if [[ ! -f "${APP_DIR}/app.asar" ]]; then
  echo "✘ app.asar missing in $APP_DIR — please run this script from the extracted veloxa-mac tarball directory."
  exit 1
fi
if [[ ! -f "${APP_DIR}/build/icon.icns" ]]; then
  echo "✘ build/icon.icns missing — bundle is incomplete."
  exit 1
fi

# --- Fetch Electron runtime ----------------------------------------------

mkdir -p "${RUNTIME_CACHE}"
if [[ ! -f "${CACHED_ZIP}" ]]; then
  echo "▸ Downloading ${ELECTRON_URL}…"
  curl --fail --location --progress-bar -o "${CACHED_ZIP}" "${ELECTRON_URL}"
else
  echo "▸ Using cached runtime: ${CACHED_ZIP}"
fi

# --- Extract into a fresh staging dir ------------------------------------

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/veloxa-stage-XXXXXX")"
trap 'rm -rf "${STAGE}"' EXIT

echo "▸ Unzipping runtime into staging dir…"
unzip -q -d "${STAGE}" "${CACHED_ZIP}"

if [[ ! -d "${STAGE}/Electron.app" ]]; then
  echo "✘ Runtime zip didn't contain Electron.app — corrupt download?"
  exit 1
fi

# --- Rename Electron.app → Veloxa Watermark Studio.app -------------------

mv "${STAGE}/Electron.app" "${STAGE}/${APP_NAME}.app"
APP="${STAGE}/${APP_NAME}.app"

# Rename the inner executable so launchd looks up the right CFBundleExecutable.
mv "${APP}/Contents/MacOS/Electron" "${APP}/Contents/MacOS/${APP_NAME}"

# Drop our app code in. Resources/app.asar is what Electron loads at startup.
cp "${APP_DIR}/app.asar" "${APP}/Contents/Resources/app.asar"

# Swap the default Electron icon for ours.
cp "${APP_DIR}/build/icon.icns" "${APP}/Contents/Resources/electron.icns"

# Patch Info.plist to point at the renamed executable + use our bundle id.
PLIST="${APP}/Contents/Info.plist"
# /usr/libexec/PlistBuddy is on every Mac since 10.5 and handles binary plists.
PB=/usr/libexec/PlistBuddy
$PB -c "Set :CFBundleExecutable ${APP_NAME}" "${PLIST}"
$PB -c "Set :CFBundleName ${APP_NAME}"        "${PLIST}"
$PB -c "Set :CFBundleDisplayName ${APP_NAME}" "${PLIST}"
$PB -c "Set :CFBundleIdentifier ${APP_BUNDLE_ID}" "${PLIST}"
# The Electron runtime ships with its own internal version string; keep our
# build's app version in CFBundleShortVersionString so the About box matches.
$PB -c "Set :CFBundleShortVersionString $(plutil -extract CFBundleShortVersionString xml1 -o - "${PLIST}" | sed -n 's/.*<string>\(.*\)<\/string>.*/\1/p' | head -n1)" "${PLIST}" 2>/dev/null || true

# --- Move into the user's working directory ------------------------------

if [[ -d "${OUT_APP}" ]]; then
  echo "▸ Removing existing ${OUT_APP}…"
  rm -rf "${OUT_APP}"
fi
mv "${APP}" "${OUT_APP}"

# --- Remove Gatekeeper quarantine flag so the unsigned app will launch ---

xattr -dr com.apple.quarantine "${OUT_APP}" 2>/dev/null || true

if [[ "${KEEP_RUNTIME}" == "0" ]]; then
  # The cached zip stays — speeds up future re-installs.
  :
fi

echo ""
echo "✔ Built ${OUT_APP}"
echo ""
echo "Move it to /Applications and double-click, or:"
echo "    open \"${OUT_APP}\""
echo ""
echo "(If macOS still complains the app is from an unidentified developer,"
echo " right-click the app → Open, then click Open in the dialog. This is a"
echo " one-time step because the build isn't code-signed.)"
