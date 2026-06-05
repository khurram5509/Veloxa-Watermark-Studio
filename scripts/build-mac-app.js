#!/usr/bin/env node
/**
 * Build a ready-to-run Veloxa Watermark Studio.app for macOS — entirely on
 * Windows, with NO Mac required and NO symlinks ever touching the Windows
 * filesystem. Output is a .zip per architecture (arm64 + x64) that a Mac
 * user can double-click in Finder → drag the .app to /Applications → run.
 *
 * Why streaming through ZIPs instead of using @electron/packager: packager
 * needs to extract Electron.app to disk during build, which requires real
 * NTFS symlinks for the framework bundle (Contents/Frameworks/Electron
 * Framework.framework/Versions/Current → A). Creating those requires
 * Developer Mode or admin on Windows, neither of which we have here.
 *
 * Instead this script:
 *   1. Downloads the official electron-v{ver}-darwin-{arch}.zip (cached).
 *   2. Reads it entry-by-entry with yauzl, preserving each entry's Unix
 *      mode bits (regular files vs symlinks vs executable bits — all live
 *      in the upper 16 bits of `externalFileAttributes`).
 *   3. Pipes every entry into a fresh ZIP via archiver, rewriting paths
 *      and patching specific files in flight:
 *        - Electron.app/                                            → Veloxa Watermark Studio.app/
 *        - .../Contents/MacOS/Electron                              → .../Contents/MacOS/Veloxa Watermark Studio
 *        - .../Contents/Resources/electron.icns                     → replaced with build/icon.icns
 *        - .../Contents/Info.plist                                  → patched (executable/name/bundleid/version)
 *        - .../Contents/Resources/default_app.asar                  → dropped (we ship our own app.asar)
 *        - .../Contents/Resources/{en,ja,...}.lproj/InfoPlist.strings → patched if they hardcode "Electron"
 *   4. Injects our own app.asar (built by @electron/packager from the
 *      project) at .../Contents/Resources/app.asar.
 *
 * Because we never create a single symlink on disk on the Windows side,
 * Developer Mode is not required. The output .zip preserves symlinks in
 * the ZIP format itself (Unix mode + the link target stored as the entry
 * content) — Apple's Archive Utility on macOS rebuilds the real symlinks
 * during extraction, and Gatekeeper / dyld then find the framework bundle
 * correctly.
 *
 * Run: npm run dist:mac:app
 * Output: release/VeloxaWatermarkStudio-2.7.2-mac-arm64.zip and -x64.zip
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const stream = require('stream');
const yauzl = require('yauzl');
const archiver = require('archiver');
const plist = require('plist');
const { spawnSync } = require('child_process');

// --- Project paths -------------------------------------------------------

const projectRoot = path.resolve(__dirname, '..');
const pkgJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const VERSION = pkgJson.version;
const ELECTRON_VERSION = (pkgJson.devDependencies.electron || '').replace(/^[^\d]*/, '') || '33.4.11';

const APP_DISPLAY_NAME = 'Veloxa Watermark Studio';
const APP_BUNDLE_NAME = `${APP_DISPLAY_NAME}.app`;
const APP_BUNDLE_ID = 'app.veloxa.watermarkstudio';
const APP_EXECUTABLE = APP_DISPLAY_NAME; // becomes Contents/MacOS/Veloxa Watermark Studio

const releaseDir = path.join(projectRoot, 'release');
fs.mkdirSync(releaseDir, { recursive: true });

const cacheDir = path.join(os.homedir(), '.cache', 'veloxa-electron');
fs.mkdirSync(cacheDir, { recursive: true });

const iconSrc = path.join(projectRoot, 'build', 'icon.icns');
if (!fs.existsSync(iconSrc)) {
  console.error('✘ build/icon.icns missing — run `node scripts/generate-icon.js` first.');
  process.exit(1);
}
const iconBuf = fs.readFileSync(iconSrc);

// --- Step 1: build the application code into app.asar via @electron/packager
//
// We re-use the same trick from build-mac.js: tell packager to produce a
// throwaway win32 build (which succeeds on Windows hosts), then steal the
// resources/app.asar it generated. That asar is platform-agnostic — Electron
// for darwin loads it identically.

const ARCHES = ['arm64', 'x64'];
const PACKAGER_IGNORES = [
  /^\/release(\/|$)/,
  /^\/tests(\/|$)/,
  /^\/scripts(\/|$)/,
  /^\/src(\/|$)/,
  /^\/build(\/|$)/,
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

console.log('▸ Building renderer (vite)…');
const viteResult = spawnSync('npm', ['run', 'build'], { cwd: projectRoot, shell: true, stdio: 'inherit' });
if (viteResult.status !== 0) { console.error('vite build failed'); process.exit(1); }

const stageRoot = path.join(os.tmpdir(), 'veloxa-mac-app-' + Date.now());
fs.mkdirSync(stageRoot, { recursive: true });
console.log('▸ Packaging app.asar via @electron/packager (host-platform build to extract the asar)…');

(async function buildAsarThenZip() {
  const packager = require('@electron/packager');
  const fn = packager.packager || packager.default || packager;
  const result = await fn({
    dir: projectRoot,
    name: 'veloxa-asar-host',
    platform: 'win32',
    arch: 'x64',
    out: stageRoot,
    electronVersion: ELECTRON_VERSION,
    overwrite: true,
    asar: true,
    prune: true,
    ignore: PACKAGER_IGNORES,
  });
  const outDir = Array.isArray(result) ? result[0] : result;
  const asarPath = path.join(outDir, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) {
    console.error('✘ No app.asar at', asarPath);
    process.exit(1);
  }
  const asarBuf = fs.readFileSync(asarPath);
  console.log(`✔ app.asar: ${(asarBuf.length / 1024 / 1024).toFixed(1)} MB`);

  // Build one .app.zip per arch
  for (const arch of ARCHES) {
    await buildOneArch(arch, asarBuf);
  }

  // Cleanup the win32 staging dir; keep the electron darwin zips cached.
  try { fs.rmSync(stageRoot, { recursive: true, force: true }); } catch {}

  console.log('');
  console.log('✔ macOS app builds complete:');
  for (const arch of ARCHES) {
    const out = path.join(releaseDir, `VeloxaWatermarkStudio-${VERSION}-mac-${arch}.zip`);
    if (fs.existsSync(out)) {
      const mb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
      console.log(`   release/${path.basename(out)}  (${mb} MB)`);
    }
  }
  console.log('');
  console.log('To install on a Mac:');
  console.log('  1. Double-click the .zip to extract.');
  console.log(`  2. Drag "${APP_BUNDLE_NAME}" to /Applications.`);
  console.log('  3. Right-click → Open → Open (first launch only — bypasses Gatekeeper for the unsigned build).');
})().catch((err) => { console.error(err); process.exit(1); });

// --- Step 2: download an electron-darwin runtime ZIP (cached) ------------

function downloadElectronDarwin(arch) {
  const file = `electron-v${ELECTRON_VERSION}-darwin-${arch}.zip`;
  const cached = path.join(cacheDir, file);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 1024 * 1024) return Promise.resolve(cached);
  const url = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${file}`;
  console.log(`▸ Downloading ${url}`);
  return new Promise((resolve, reject) => {
    const tmp = cached + '.partial';
    const out = fs.createWriteStream(tmp);
    let totalBytes = 0, lastLogged = 0;
    function fetchTo(u) {
      https.get(u, { headers: { 'User-Agent': 'veloxa-mac-build/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); return fetchTo(res.headers.location);
        }
        if (res.statusCode !== 200) {
          out.destroy(); fs.unlinkSync(tmp);
          return reject(new Error(`${res.statusCode} ${url}`));
        }
        const total = Number(res.headers['content-length'] || 0);
        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (total && totalBytes - lastLogged > total / 20) {
            lastLogged = totalBytes;
            const pct = ((totalBytes / total) * 100).toFixed(0);
            process.stdout.write(`\r   ${pct}% (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
          }
        });
        res.pipe(out);
        out.on('finish', () => {
          process.stdout.write('\r' + ' '.repeat(60) + '\r');
          fs.renameSync(tmp, cached);
          console.log(`✔ Cached ${cached}`);
          resolve(cached);
        });
      }).on('error', reject);
    }
    fetchTo(url);
  });
}

// --- Step 3: stream Electron.zip → Veloxa.app.zip ------------------------

async function buildOneArch(arch, asarBuf) {
  const electronZip = await downloadElectronDarwin(arch);
  const outZip = path.join(releaseDir, `VeloxaWatermarkStudio-${VERSION}-mac-${arch}.zip`);
  try { fs.unlinkSync(outZip); } catch {}

  console.log(`\n▸ Assembling ${path.basename(outZip)}`);

  return new Promise((resolve, reject) => {
    yauzl.open(electronZip, { lazyEntries: true, autoClose: true }, (err, zipfile) => {
      if (err) return reject(err);

      const out = fs.createWriteStream(outZip);
      const ar = archiver('zip', { zlib: { level: 6 } });
      ar.on('warning', (w) => console.warn('  ⚠', w.message));
      ar.on('error', (e) => reject(e));
      ar.pipe(out);

      let infoPlistPatched = false;
      let executableRenamed = false;
      let iconReplaced = false;
      let asarInjected = false;
      let entryCount = 0;
      let symlinkCount = 0;

      // We collect Info.plist + the binary executable specially because we
      // both rename AND patch them in-flight. Everything else is a straight
      // pass-through with the path rewritten.
      zipfile.on('entry', (entry) => {
        entryCount++;
        const origName = entry.fileName;

        // Skip top-level ZIP metadata (LICENSE, version, etc — they live
        // outside Electron.app and aren't needed in the final bundle).
        if (!origName.startsWith('Electron.app/')) {
          zipfile.readEntry();
          return;
        }

        // Compute the rewritten path inside Veloxa Watermark Studio.app.
        let newName = origName.replace(/^Electron\.app\//, APP_BUNDLE_NAME + '/');

        // Drop default_app.asar — Electron's stub UI that opens when no
        // app.asar is found. We're providing app.asar so this is dead weight.
        if (origName === 'Electron.app/Contents/Resources/default_app.asar') {
          zipfile.readEntry();
          return;
        }

        // The main executable: Electron.app/Contents/MacOS/Electron → rename
        // file at path level so dyld finds it via CFBundleExecutable.
        if (origName === 'Electron.app/Contents/MacOS/Electron') {
          newName = `${APP_BUNDLE_NAME}/Contents/MacOS/${APP_EXECUTABLE}`;
          executableRenamed = true;
        }

        // Decode this entry's Unix mode from the upper 16 bits of the ZIP
        // external file attributes. Symlinks are 0o120000, executables have
        // 0o755-ish in the lower bits, regular files 0o644-ish.
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xFFFF;
        const isSymlink = (unixMode & 0o170000) === 0o120000;
        const isDir = /\/$/.test(origName);

        if (isDir) {
          // archiver auto-creates dirs from file paths, skip explicit dir entries.
          zipfile.readEntry();
          return;
        }

        // ---- SYMLINK ----
        // The "content" of a symlink entry is the link target as plain text.
        // We read it, then emit an archiver symlink entry — no FS touch.
        if (isSymlink) {
          zipfile.openReadStream(entry, (e, rs) => {
            if (e) return reject(e);
            const chunks = [];
            rs.on('data', (c) => chunks.push(c));
            rs.on('end', () => {
              const linkTarget = Buffer.concat(chunks).toString('utf8');
              ar.symlink(newName, linkTarget, unixMode & 0o7777);
              symlinkCount++;
              zipfile.readEntry();
            });
            rs.on('error', reject);
          });
          return;
        }

        // ---- REGULAR FILE ----
        zipfile.openReadStream(entry, (e, rs) => {
          if (e) return reject(e);
          const chunks = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => {
            let body = Buffer.concat(chunks);

            // Patch Info.plist
            if (origName === 'Electron.app/Contents/Info.plist') {
              try {
                const parsed = plist.parse(body.toString('utf8'));
                parsed.CFBundleExecutable = APP_EXECUTABLE;
                parsed.CFBundleName = APP_DISPLAY_NAME;
                parsed.CFBundleDisplayName = APP_DISPLAY_NAME;
                parsed.CFBundleIdentifier = APP_BUNDLE_ID;
                parsed.CFBundleShortVersionString = VERSION;
                parsed.CFBundleVersion = VERSION;
                // Keep the existing CFBundleIconFile (it stays "electron.icns",
                // which is the filename we drop in place of the original icns).
                body = Buffer.from(plist.build(parsed), 'utf8');
                infoPlistPatched = true;
              } catch (perr) {
                console.warn('  ⚠ Info.plist patch failed:', perr.message);
              }
            }

            // Replace electron.icns with our Veloxa icon
            if (origName === 'Electron.app/Contents/Resources/electron.icns') {
              body = iconBuf;
              iconReplaced = true;
            }

            // archiver wants the Unix mode (file type bits + perms). For
            // regular files we keep the perms intact (e.g. 0o755 on the
            // binary, 0o644 on data files).
            ar.append(body, {
              name: newName,
              mode: unixMode & 0o7777 || (origName.endsWith('/Electron') ? 0o755 : 0o644),
              date: new Date('2026-06-05T00:00:00Z'), // deterministic
            });

            zipfile.readEntry();
          });
          rs.on('error', reject);
        });
      });

      zipfile.on('end', () => {
        // Inject our app.asar
        ar.append(asarBuf, {
          name: `${APP_BUNDLE_NAME}/Contents/Resources/app.asar`,
          mode: 0o644,
          date: new Date('2026-06-05T00:00:00Z'),
        });
        asarInjected = true;

        ar.finalize();
      });

      zipfile.on('error', reject);

      out.on('close', () => {
        const sz = (fs.statSync(outZip).size / 1024 / 1024).toFixed(1);
        console.log(`✔ ${path.basename(outZip)} — ${sz} MB`);
        console.log(`   entries: ${entryCount}, symlinks preserved: ${symlinkCount}`);
        if (!executableRenamed) console.warn('  ⚠ executable not renamed!');
        if (!infoPlistPatched) console.warn('  ⚠ Info.plist not patched!');
        if (!iconReplaced) console.warn('  ⚠ icon not replaced!');
        if (!asarInjected) console.warn('  ⚠ app.asar not injected!');
        resolve();
      });

      zipfile.readEntry();
    });
  });
}
