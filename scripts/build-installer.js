#!/usr/bin/env node
/**
 * One-shot installer build:
 *   1. Run vite to produce dist/ (renderer bundle)
 *   2. Run @electron/packager to produce a fresh
 *      release/Veloxa Watermark Studio-win32-x64/ from current source
 *   3. Locate Inno Setup's ISCC.exe (or fail with install instructions)
 *   4. Compile scripts/installer.iss → %TEMP%\veloxa-installer-build\
 *   5. Move the resulting setup .exe into release/
 *
 * CRITICAL: steps 1 and 2 used to be the caller's responsibility — and were
 * routinely skipped. The result: every installer built between June 5 and
 * v2.8.2 wrapped Inno around the same v2.7.5-era app.asar, with only the
 * outer Inno metadata reflecting the new version number. Users installed
 * "v2.8.2" but actually got v2.7.5 code with a v2.8.2 stamp — explaining
 * the persistent "title bar shows v2.4.1 after install" complaints, plus
 * the install crashes that motivated this fix.
 *
 * From v2.8.3 onwards `npm run installer` re-runs the full chain so the
 * installer ALWAYS contains the latest source.
 *
 * Usage:  node scripts/build-installer.js   (or `npm run installer`)
 *   --skip-vite      Skip step 1 (use existing dist/)
 *   --skip-package   Skip step 2 (use existing packaged dir)
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

const args = new Set(process.argv.slice(2));
const skipVite = args.has('--skip-vite');
const skipPackage = args.has('--skip-package');

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

// ---- Step 1: vite build (renderer) ----
if (!skipVite) {
  console.log('▸ Step 1/3: vite build (renderer bundle)');
  const vite = spawnSync('npm', ['run', 'build'], {
    cwd: projectRoot, stdio: 'inherit', shell: true,
  });
  if (vite.status !== 0) bail('vite build failed');
  console.log('✔ Renderer bundle ready in dist/');
  console.log('');
}

// ---- Step 2: @electron/packager (refresh the packaged app) ----
// CRITICAL: this is what was missing for ~2 months of releases. Without
// this re-packaging step, the installer just keeps wrapping Inno around
// whatever app.asar happened to be in the packagedDir on June 5, regardless
// of what the source code says.
if (!skipPackage) {
  console.log('▸ Step 2/3: @electron/packager (refresh win32-x64 from current source)');
  // Use the Node API directly — the CLI suffers from cmd.exe argument
  // escaping issues with our project's spaces in the path (e.g. "0 AI").
  (async () => {
    try {
      // Clean the old packaged dir first so stale files can't leak in.
      try { fs.rmSync(packagedDir, { recursive: true, force: true }); } catch {}

      const packager = require('@electron/packager');
      const fn = packager.packager || packager.default || packager;
      const PACKAGER_IGNORES = [
        /^\/release(\/|$)/,
        /^\/tests(\/|$)/,
        /^\/scripts(\/|$)/,
        /^\/src(\/|$)/,
        /^\/\.git(\/|$)/,
        /^\/\.claude(\/|$)/,
        /^\/\.vscode(\/|$)/,
        /^\/INSTALL\.md$/,
        /^\/README\.md$/,
        /^\/\.gitignore$/,
        /^\/\.gitattributes$/,
        /^\/postcss\.config\.js$/,
        /^\/tailwind\.config\.js$/,
        /^\/vite\.config\.js$/,
        /^\/index\.html$/,
        /\.tmp(\.|$)/,
        /^\/\.npmrc$/,
      ];

      const result = await fn({
        dir: projectRoot,
        name: 'Veloxa Watermark Studio',
        platform: 'win32',
        arch: 'x64',
        out: releaseDir,
        overwrite: true,
        asar: true,
        prune: true,
        icon: path.join(projectRoot, 'build', 'icon.ico'),
        ignore: PACKAGER_IGNORES,
      });
      const outDir = Array.isArray(result) ? result[0] : result;
      console.log(`✔ Packaged app: ${outDir}`);
      console.log('');
      runInno();
    } catch (err) {
      bail(`Packager failed: ${err.message}`);
    }
  })();
} else {
  console.log('▸ Step 2/3: SKIPPED (--skip-package)');
  console.log('');
  runInno();
}

function runInno() {
  if (!fs.existsSync(packagedDir)) {
    bail(
      `Packaged app not found at:\n   ${packagedDir}\n\n` +
      'Run the packager first or remove --skip-package.',
    );
  }
if (!fs.existsSync(issPath)) {
  bail(`Installer script not found: ${issPath}`);
}
// Generate the icon if it's missing. Earlier builds shipped without one
// because SetupIconFile was blank — Inno fell back to its default icon
// (no Veloxa branding on the installer .exe or the Programs entry).
const iconPath = path.join(projectRoot, 'build', 'icon.ico');
if (!fs.existsSync(iconPath)) {
  console.log('Icon missing — running scripts/generate-icon.js to build it…');
  const gen = spawnSync(process.execPath,
    [path.join(__dirname, 'generate-icon.js')], { stdio: 'inherit' });
  if (gen.status !== 0) bail('Icon generation failed; rerun manually with `node scripts/generate-icon.js`.');
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
} // end runInno
