#!/usr/bin/env node
/**
 * One-shot installer build:
 *   1. Locate Inno Setup's ISCC.exe (or fail with install instructions)
 *   2. Compile scripts/installer.iss → %TEMP%\veloxa-installer-build\
 *   3. Move the resulting setup .exe into release/
 *
 * Prerequisites: the packaged Electron app must already exist at
 * release/Veloxa Watermark Studio-win32-x64/ (run @electron/packager first).
 *
 * Usage:  node scripts/build-installer.js   (or `npm run installer`)
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const issPath = path.join(projectRoot, 'scripts', 'installer.iss');
const releaseDir = path.join(projectRoot, 'release');
const packagedDir = path.join(releaseDir, 'Veloxa Watermark Studio-win32-x64');
const version = require(path.join(projectRoot, 'package.json')).version;
const setupName = `VeloxaWatermarkStudio-Setup-${version}.exe`;
const tempBuildDir = path.join(os.tmpdir(), 'veloxa-installer-build');

function findISCC() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 5\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 5\\ISCC.exe',
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch {}
  }
  return null;
}

function bail(msg) {
  console.error(`\n✘ ${msg}\n`);
  process.exit(1);
}

console.log(`Veloxa installer builder — v${version}`);
console.log('');

if (!fs.existsSync(packagedDir)) {
  bail(
    `Packaged app not found at:\n   ${packagedDir}\n\n` +
    'Run the packager first:\n' +
    '   npx @electron/packager . "Veloxa Watermark Studio" --platform=win32 --arch=x64 --out=release --overwrite --asar',
  );
}
if (!fs.existsSync(issPath)) {
  bail(`Installer script not found: ${issPath}`);
}

const iscc = findISCC();
if (!iscc) {
  bail(
    'Inno Setup not found. Install it via:\n' +
    '   winget install --id JRSoftware.InnoSetup --silent --accept-package-agreements --accept-source-agreements\n' +
    'Or download manually from https://jrsoftware.org/isdl.php',
  );
}
console.log(`✔ ISCC: ${iscc}`);
console.log(`✔ Source: ${issPath}`);
console.log(`✔ Packaged app: ${packagedDir}`);
console.log('');
console.log('Compiling installer (this can take 30-90 seconds for ~290MB of payload)...');

const result = spawnSync(iscc, [issPath], { stdio: 'inherit' });
if (result.status !== 0) {
  bail(`ISCC exited with status ${result.status}`);
}

const builtPath = path.join(tempBuildDir, setupName);
if (!fs.existsSync(builtPath)) {
  bail(`ISCC reported success but installer not found at ${builtPath}`);
}

const finalPath = path.join(releaseDir, setupName);

// Retry copy because Dropbox / antivirus / Windows search may briefly hold
// the destination after we touch it. Strategy:
//   1. Copy to a tmp-suffixed name (release/foo.exe.new) — never collides
//   2. Atomically rename .new → final, retrying on EBUSY (proper async sleep)
//   3. Fall back to a timestamped filename if rename can't replace the original
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safePublish(src, dst) {
  const tmpDst = `${dst}.new`;
  try { fs.unlinkSync(tmpDst); } catch {}
  fs.copyFileSync(src, tmpDst);

  for (let i = 0; i < 8; i += 1) {
    try {
      try { fs.unlinkSync(dst); } catch { /* not present */ }
      fs.renameSync(tmpDst, dst);
      return dst;
    } catch (err) {
      if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
        const wait = 1000 + i * 500;
        console.warn(`  publish attempt ${i + 1}/8 blocked (${err.code}) — waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  // Fallback — keep the original (Dropbox-locked) file and write a stamped one
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const altPath = dst.replace(/\.exe$/i, `-${stamp}.exe`);
  fs.renameSync(tmpDst, altPath);
  console.warn(`  Original file is locked by another process. Wrote installer with timestamp suffix instead:`);
  console.warn(`    ${altPath}`);
  return altPath;
}

(async () => {
  const written = await safePublish(builtPath, finalPath);
  const sizeMb = (fs.statSync(written).size / (1024 * 1024)).toFixed(1);
  console.log('');
  console.log(`✔ Installer ready (${sizeMb} MB):`);
  console.log(`   ${written}`);
})().catch((err) => bail(err.message || String(err)));
