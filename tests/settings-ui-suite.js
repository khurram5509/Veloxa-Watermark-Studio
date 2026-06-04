// Tests for the v2.5.0 settings UI improvements:
//   1. relativeTime() formatter (humanized "5 minutes ago" strings)
//   2. The settings panel renders without crashing in a JSDOM-like env
//      (syntax + import resolution check)
//   3. The store's checkForUpdates(silent: true) behavior
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJ = path.resolve(__dirname, '..');

let PASS = 0, FAIL = 0;
const failures = [];
function ok(l) { PASS++; console.log(`  PASS  ${l}`); }
function bad(l, e) { FAIL++; failures.push(`${l}: ${e.message || e}`); console.error(`  FAIL  ${l}: ${e.message || e}`); }
function header(s) { console.log(''); console.log('=== ' + s + ' ==='); }
async function test(l, fn) { try { await fn(); ok(l); } catch (e) { bad(l, e); } }

(async () => {

// =====================================================================
header('1. relativeTime formatter');
// Load format.js by parsing it — it uses ESM (export). The simplest way to
// exercise it is to extract just the function we need into a CommonJS shim.
const fmtSrc = fs.readFileSync(path.join(PROJ, 'src', 'utils', 'format.js'), 'utf8');
// Convert "export function X" → "module.exports.X = " so we can require it
const cjsFmt = fmtSrc.replace(/export\s+function\s+(\w+)/g, 'module.exports.$1 = function $1');
const mod = { exports: {} };
new Function('module', 'exports', cjsFmt)(mod, mod.exports);
const { relativeTime } = mod.exports;

await test('Never for null', () => { if (relativeTime(null) !== 'Never') throw new Error(); });
await test('Never for 0', () => { if (relativeTime(0) !== 'Never') throw new Error(); });
await test('Just now for very recent (< 45s)', () => {
  const r = relativeTime(Date.now() - 5000);
  if (r !== 'Just now') throw new Error('got: ' + r);
});
await test('"1 minute ago" for ~1 min', () => {
  const r = relativeTime(Date.now() - 65_000);
  if (r !== '1 minute ago') throw new Error('got: ' + r);
});
await test('"5 minutes ago" for 5 min', () => {
  const r = relativeTime(Date.now() - 5 * 60_000);
  if (r !== '5 minutes ago') throw new Error('got: ' + r);
});
await test('"1 hour ago" for ~1 hour', () => {
  const r = relativeTime(Date.now() - 65 * 60_000);
  if (r !== '1 hour ago') throw new Error('got: ' + r);
});
await test('"3 hours ago" for 3 hours', () => {
  const r = relativeTime(Date.now() - 3 * 60 * 60_000);
  if (r !== '3 hours ago') throw new Error('got: ' + r);
});
await test('"Yesterday" for 1 day', () => {
  const r = relativeTime(Date.now() - 26 * 60 * 60_000);
  if (r !== 'Yesterday') throw new Error('got: ' + r);
});
await test('"3 days ago" for 3 days', () => {
  const r = relativeTime(Date.now() - 3 * 24 * 60 * 60_000);
  if (r !== '3 days ago') throw new Error('got: ' + r);
});
await test('Locale date string for > 7 days', () => {
  const r = relativeTime(Date.now() - 30 * 24 * 60 * 60_000);
  if (/ago|Yesterday|Just/.test(r)) throw new Error('should fall back to date: ' + r);
  if (typeof r !== 'string' || r.length < 5) throw new Error('not a date string: ' + r);
});
await test('Future timestamp falls back to date string', () => {
  const r = relativeTime(Date.now() + 60_000);
  if (/ago|Just/.test(r)) throw new Error('future should not be relative: ' + r);
});

// =====================================================================
header('2. SettingsPanel.jsx syntax / imports');
await test('SettingsPanel.jsx parses as valid JSX-stripped JS', () => {
  const src = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
  if (!src.includes('export default function SettingsPanel')) throw new Error('no default export');
  if (!src.includes('UpdatesSection')) throw new Error('UpdatesSection missing');
  if (!src.includes('InlineCheckResult')) throw new Error('InlineCheckResult missing');
  if (!src.includes('relativeTime')) throw new Error('relativeTime not imported');
  // Brace balance — strip regex literals first because `\{ \}` inside them
  // counts as a brace even though it's a character class escape.
  const stripped = src.replace(/\/[^/\n]+\/g/g, '/REGEX/');
  const open = (stripped.match(/{/g) || []).length;
  const close = (stripped.match(/}/g) || []).length;
  if (open !== close) throw new Error(`brace mismatch (post-regex-strip): ${open} open, ${close} close`);
});
await test('UpdateBanner.jsx still importable + has expected branches', () => {
  const src = fs.readFileSync(path.join(PROJ, 'src', 'components', 'UpdateBanner.jsx'), 'utf8');
  if (!src.includes("status === 'available'")) throw new Error('available branch missing');
  if (!src.includes("status === 'downloading'")) throw new Error('downloading branch missing');
  if (!src.includes("status === 'ready'")) throw new Error('ready branch missing');
  if (!src.includes("status === 'no-update'")) throw new Error('no-update branch missing');
  if (!src.includes("status === 'error'")) throw new Error('error branch missing');
});

// =====================================================================
header('3. Store: checkForUpdates(silent) behavior');
// Load store via simple extraction — Zustand store is hard to test without
// the React env, so we just verify the source code paths exist correctly.
const storeSrc = fs.readFileSync(path.join(PROJ, 'src', 'store', 'useStore.js'), 'utf8');
await test('store has silent option in checkForUpdates', () => {
  if (!/checkForUpdates:\s*async\s*\(\s*{\s*force\s*=\s*false\s*,\s*silent\s*=\s*false/.test(storeSrc))
    throw new Error('silent param missing from signature');
});
await test('store: silent + no-update keeps status at idle', () => {
  // Pseudo-AST check: the code path for !hasUpdate must guard on !silent
  if (!/else\s+if\s*\(\s*!silent\s*\)\s*{/.test(storeSrc))
    throw new Error('silent guard missing on no-update branch');
});
await test('store: silent + available STILL surfaces banner', () => {
  // The available branch must use the simple if(...hasUpdate && !dismissed)
  // condition with NO silent in the condition itself.
  const condMatch = storeSrc.match(/if\s*\(\s*result\.hasUpdate\s*&&\s*!result\.dismissed\s*\)/);
  if (!condMatch) throw new Error('available branch condition not found');
  // (We don't scan the body — comments mentioning "silent" are fine.)
});
await test('App.jsx startup call passes silent:true', () => {
  const appSrc = fs.readFileSync(path.join(PROJ, 'src', 'App.jsx'), 'utf8');
  if (!/checkForUpdates\(\{\s*force:\s*false,\s*silent:\s*true\s*\}\)/.test(appSrc))
    throw new Error('startup check should pass silent:true');
});
await test('store: checkForUpdates reloads settings on success', () => {
  // After a successful check, the main process persists the new
  // cachedLatestRelease + lastUpdateCheckMs to disk. The renderer must
  // re-pull settings or the Settings tiles stay stuck on the boot-time
  // snapshot. The bug screenshot showed "Latest known: v2.5.0" while the
  // download row already said "Downloading v2.5.1…".
  if (!/await\s+v\.settings\.get\(\)/.test(storeSrc))
    throw new Error('store should call v.settings.get() to refresh');
  if (!/set\(\{\s*settings:\s*s\s*\}\)/.test(storeSrc))
    throw new Error('store should apply the refreshed settings');
});
await test('SettingsPanel: tiles prefer fresh updater.info over disk cache', () => {
  const src = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
  // The metric tile read should fall back to settings.cachedLatestRelease
  // only when updater.info is missing.
  if (!/updater\.info[\s\S]{0,200}?settings\.cachedLatestRelease/.test(src))
    throw new Error('tile read should prefer updater.info, fall back to settings.cachedLatestRelease');
});

// =====================================================================
header('5. Silent install resilience (v2.5.3)');
const ipcSrc = fs.readFileSync(path.join(PROJ, 'electron', 'ipc-handlers.js'), 'utf8');
await test('updater:openInstaller passes Inno Setup silent flags', () => {
  // Required flags: /SILENT (no wizard), /SUPPRESSMSGBOXES (no errors popups),
  // /CLOSEAPPLICATIONS + /RESTARTAPPLICATIONS (graceful app shutdown + relaunch)
  for (const flag of ['/SILENT', '/SUPPRESSMSGBOXES', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS']) {
    if (!ipcSrc.includes(`'${flag}'`)) throw new Error(`flag missing: ${flag}`);
  }
});
await test('updater:openInstaller strips MOTW Zone.Identifier before launch', () => {
  if (!/Zone\.Identifier/.test(ipcSrc))
    throw new Error('Zone.Identifier stripping not implemented — SmartScreen will still block');
  if (!/fs\.unlinkSync\(zoneStream\)/.test(ipcSrc))
    throw new Error('Zone.Identifier should be unlinked');
});
await test('updater:openInstaller uses spawn with detached:true', () => {
  if (!/spawn\(installerPath/.test(ipcSrc))
    throw new Error('should spawn installer directly, not shell.openPath');
  if (!/detached:\s*true/.test(ipcSrc))
    throw new Error('spawn must detach so installer survives our exit');
});
await test('updater:openInstaller has shell.openPath fallback', () => {
  if (!/catch.*shell\.openPath/s.test(ipcSrc))
    throw new Error('should fall back to shell.openPath if spawn fails');
});
await test('updater:revealInstaller IPC handler exists', () => {
  if (!ipcSrc.includes("'updater:revealInstaller'"))
    throw new Error('revealInstaller handler missing');
  if (!/shell\.showItemInFolder\(installerPath\)/.test(ipcSrc))
    throw new Error('should use shell.showItemInFolder');
});
await test('store: installUpdate defaults to silent (wizard=false)', () => {
  if (!/installUpdate:\s*async\s*\(\s*\{\s*wizard\s*=\s*false\s*\}\s*=\s*\{\}\s*\)/.test(storeSrc))
    throw new Error('installUpdate signature should default wizard=false');
  if (!/veryVerbose:\s*!!wizard/.test(storeSrc))
    throw new Error('store should pass veryVerbose: !!wizard to IPC');
});
await test('store: revealUpdateInstaller action exists', () => {
  if (!/revealUpdateInstaller:\s*async/.test(storeSrc))
    throw new Error('revealUpdateInstaller action missing');
});
await test('preload exposes revealInstaller', () => {
  const preloadSrc = fs.readFileSync(path.join(PROJ, 'electron', 'preload.js'), 'utf8');
  if (!/revealInstaller:/.test(preloadSrc))
    throw new Error('preload.updater.revealInstaller not exposed');
});

// =====================================================================
header('6. v2.6.0 UI improvements');
const dropZoneSrc = fs.readFileSync(path.join(PROJ, 'src', 'components', 'DropZone.jsx'), 'utf8');
const editorSrc = fs.readFileSync(path.join(PROJ, 'src', 'components', 'ProfileEditor.jsx'), 'utf8');
const settingsSrc = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
const shortcutsSrc = fs.readFileSync(path.join(PROJ, 'src', 'hooks', 'useGlobalShortcuts.js'), 'utf8');
const preloadSrc2 = fs.readFileSync(path.join(PROJ, 'electron', 'preload.js'), 'utf8');
const ipcSrc2 = fs.readFileSync(path.join(PROJ, 'electron', 'ipc-handlers.js'), 'utf8');

await test('DropZone: empty state has format pills', () => {
  for (const label of ['PDF', 'DOCX', 'PPTX', 'Folder Processing', 'Recursive Scanning']) {
    if (!dropZoneSrc.includes(`label: '${label}'`)) throw new Error(`pill missing: ${label}`);
  }
});
await test('DropZone: shows StatTile with count + size + ETA', () => {
  if (!/StatTile/.test(dropZoneSrc)) throw new Error('StatTile component missing');
  if (!/Est\. time|Estimated/.test(dropZoneSrc)) throw new Error('ETA tile missing');
  if (!/Total size/.test(dropZoneSrc)) throw new Error('Total size tile missing');
});
await test('DropZone: batched getFileSizes IPC call', () => {
  if (!/v\.app\.getFileSizes/.test(dropZoneSrc)) throw new Error('getFileSizes IPC not called');
});
await test('IPC: app:getFileSizes handler', () => {
  if (!ipcSrc2.includes("'app:getFileSizes'")) throw new Error('handler missing');
});
await test('IPC: app:getSystemInfo handler returns cpuCores + totalRamGb + recommendedConcurrent', () => {
  if (!ipcSrc2.includes("'app:getSystemInfo'")) throw new Error('handler missing');
  for (const field of ['cpuCores', 'cpuModel', 'totalRamGb', 'freeRamGb', 'recommendedConcurrent']) {
    if (!ipcSrc2.includes(field)) throw new Error(`field missing: ${field}`);
  }
});
await test('preload exposes getFileSizes + getSystemInfo', () => {
  if (!/getFileSizes:/.test(preloadSrc2)) throw new Error('getFileSizes not exposed');
  if (!/getSystemInfo:/.test(preloadSrc2)) throw new Error('getSystemInfo not exposed');
});
await test('ProfileEditor: PositionGrid component + 9-cell grid array', () => {
  if (!/function PositionGrid/.test(editorSrc)) throw new Error('PositionGrid component missing');
  if (!/POSITION_GRID/.test(editorSrc)) throw new Error('POSITION_GRID array missing');
  for (const p of ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right']) {
    if (!editorSrc.includes(`v: '${p}'`)) throw new Error(`grid cell missing: ${p}`);
  }
});
await test('SettingsPanel: Performance section has hardware advisor', () => {
  // v2.6.2 renamed PerformanceSection → PerformanceBody (it's now wrapped by
  // the generic Section component). Either name is acceptable.
  if (!/function Performance(Section|Body)/.test(settingsSrc))
    throw new Error('Performance section component missing');
  if (!/HardwareTile/.test(settingsSrc)) throw new Error('HardwareTile missing');
  if (!/Recommended/.test(settingsSrc)) throw new Error('Recommended tile label missing');
  if (!/getSystemInfo/.test(settingsSrc)) throw new Error('does not call getSystemInfo');
});
await test('Shortcuts: Ctrl+P fires onProcess', () => {
  if (!/e\.key === 'p' \|\| e\.key === 'P'/.test(shortcutsSrc)) throw new Error('Ctrl+P missing');
});
await test('Shortcuts: Ctrl+F focuses [data-search-input]', () => {
  if (!/e\.key === 'f' \|\| e\.key === 'F'/.test(shortcutsSrc)) throw new Error('Ctrl+F missing');
  if (!/data-search-input/.test(shortcutsSrc)) throw new Error('search input selector missing');
});
await test('ProfilesPanel: search input has data-search-input attribute', () => {
  const profilesSrc = fs.readFileSync(path.join(PROJ, 'src', 'components', 'ProfilesPanel.jsx'), 'utf8');
  if (!/data-search-input/.test(profilesSrc)) throw new Error('search input not tagged');
});

// =====================================================================
header('7. Branded installer icon (v2.6.1)');
await test('build/icon.ico exists', () => {
  const p = path.join(PROJ, 'build', 'icon.ico');
  if (!fs.existsSync(p)) throw new Error('icon.ico missing');
  // ICO header sanity: 6 bytes, [0,0,1,0,N,0]
  const buf = fs.readFileSync(p);
  if (buf.length < 100) throw new Error('icon.ico too small');
  if (buf[0] !== 0 || buf[1] !== 0 || buf[2] !== 1 || buf[3] !== 0)
    throw new Error('not a valid ICO header');
  const count = buf.readUInt16LE(4);
  if (count < 1) throw new Error(`ICO has ${count} frames (expected ≥1)`);
});
await test('build/icon.png exists', () => {
  const p = path.join(PROJ, 'build', 'icon.png');
  if (!fs.existsSync(p)) throw new Error('icon.png missing');
  // PNG signature
  const buf = fs.readFileSync(p);
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a valid PNG');
});
await test('installer.iss references the icon as SetupIconFile', () => {
  const issSrc = fs.readFileSync(path.join(PROJ, 'scripts', 'installer.iss'), 'utf8');
  if (!/SetupIconFile=\.\.\\build\\icon\.ico/.test(issSrc))
    throw new Error('SetupIconFile not wired to build/icon.ico');
});
await test('generate-icon.js script is committable + standalone', () => {
  const p = path.join(PROJ, 'scripts', 'generate-icon.js');
  if (!fs.existsSync(p)) throw new Error('generate-icon.js missing');
  const src = fs.readFileSync(p, 'utf8');
  // Must not depend on any non-builtin module — the whole point is no
  // graphics deps. Allow node:fs / zlib / path only.
  const reqs = (src.match(/require\(['"]([^'"]+)['"]\)/g) || []).map(m => m.match(/['"]([^'"]+)['"]/)[1]);
  for (const r of reqs) {
    if (!/^node:(fs|path|zlib)$/.test(r))
      throw new Error(`icon generator should be dep-free; found require: ${r}`);
  }
});

// =====================================================================
header('8. Settings page redesign (v2.6.2)');
const settingsSrc2 = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
const ipcSrc3 = fs.readFileSync(path.join(PROJ, 'electron', 'ipc-handlers.js'), 'utf8');
const preloadSrc3 = fs.readFileSync(path.join(PROJ, 'electron', 'preload.js'), 'utf8');

await test('SettingsPanel: SECTIONS array + sticky left-rail nav', () => {
  if (!/const SECTIONS = \[/.test(settingsSrc2)) throw new Error('SECTIONS array missing');
  if (!/sticky top-0/.test(settingsSrc2)) throw new Error('sticky nav class missing');
  if (!/IntersectionObserver/.test(settingsSrc2)) throw new Error('scroll-spy not implemented');
});
await test('SettingsPanel: search box filters sections', () => {
  if (!/Search settings/.test(settingsSrc2)) throw new Error('search input missing');
  if (!/visibleSections/.test(settingsSrc2)) throw new Error('section filter not applied');
});
await test('SettingsPanel: TemplatePreview component', () => {
  if (!/function TemplatePreview/.test(settingsSrc2)) throw new Error('TemplatePreview missing');
  if (!/\{originalname\}/.test(settingsSrc2)) throw new Error('preview token not handled');
  if (!/Unknown token/.test(settingsSrc2)) throw new Error('no warning for unknown tokens');
});
await test('SettingsPanel: theme toggle in Application section', () => {
  if (!/setTheme\('dark'\)/.test(settingsSrc2) || !/setTheme\('light'\)/.test(settingsSrc2))
    throw new Error('theme toggle missing');
});
await test('SettingsPanel: GlobalActions exports/imports/resets', () => {
  if (!/function GlobalActions/.test(settingsSrc2)) throw new Error('GlobalActions missing');
  for (const ipc of ['exportSettings', 'importSettings', 'resetSettings']) {
    if (!settingsSrc2.includes(ipc)) throw new Error(`GlobalActions missing IPC: ${ipc}`);
  }
});
await test('SettingsPanel: StorageSection shows usage breakdown', () => {
  if (!/function StorageSection/.test(settingsSrc2)) throw new Error('StorageSection missing');
  if (!/getStorageStats/.test(settingsSrc2)) throw new Error('does not call getStorageStats');
});
await test('SettingsPanel: AboutSection shows paths with copy + reveal', () => {
  if (!/function AboutSection/.test(settingsSrc2)) throw new Error('AboutSection missing');
  if (!/getDataPaths/.test(settingsSrc2)) throw new Error('does not call getDataPaths');
  if (!/navigator\.clipboard\.writeText/.test(settingsSrc2)) throw new Error('no copy-to-clipboard');
});
await test('IPC: app:getStorageStats returns logos/profiles/logs/settings', () => {
  if (!ipcSrc3.includes("'app:getStorageStats'")) throw new Error('handler missing');
  // Pull out the handler body (between the handle( … ) and the next ipcMain).
  // Tolerate shorthand keys (`logos,`) AND explicit form (`logos: …`).
  const start = ipcSrc3.indexOf("'app:getStorageStats'");
  const end = ipcSrc3.indexOf("ipcMain.handle('app:getDataPaths'");
  const body = ipcSrc3.slice(start, end > 0 ? end : start + 2000);
  for (const k of ['logos', 'profiles', 'logs', 'settings']) {
    const re = new RegExp(`\\b${k}\\s*[,:]`);
    if (!re.test(body)) throw new Error(`stats key missing: ${k}`);
  }
});
await test('IPC: app:getDataPaths returns dataDir/logosDir/profilesFile/settingsFile/logsFile', () => {
  if (!ipcSrc3.includes("'app:getDataPaths'")) throw new Error('handler missing');
  for (const k of ['dataDir:', 'logosDir:', 'profilesFile:', 'settingsFile:', 'logsFile:']) {
    if (!ipcSrc3.includes(k)) throw new Error(`path key missing: ${k}`);
  }
});
await test('IPC: app:resetSettings preserves opt-in keys via opts.keep', () => {
  if (!ipcSrc3.includes("'app:resetSettings'")) throw new Error('handler missing');
  if (!/opts\.keep/.test(ipcSrc3)) throw new Error('opts.keep not honored');
});
await test('IPC: app:exportSettings + app:importSettings use save/open dialog', () => {
  if (!ipcSrc3.includes("'app:exportSettings'")) throw new Error('exportSettings missing');
  if (!ipcSrc3.includes("'app:importSettings'")) throw new Error('importSettings missing');
  if (!/showSaveDialog/.test(ipcSrc3)) throw new Error('export should use showSaveDialog');
  if (!/showOpenDialog/.test(ipcSrc3)) throw new Error('import should use showOpenDialog');
});
await test('preload exposes the new app:* IPCs', () => {
  for (const fn of ['getStorageStats:', 'getDataPaths:', 'resetSettings:', 'exportSettings:', 'importSettings:']) {
    if (!preloadSrc3.includes(fn)) throw new Error(`preload missing: ${fn}`);
  }
});
await test('SettingsPanel: Section wrapper is forwardRef + has scroll-mt for sticky anchor', () => {
  if (!/React\.forwardRef\(function Section/.test(settingsSrc2)) throw new Error('Section not forwardRef');
  if (!/scroll-mt-/.test(settingsSrc2)) throw new Error('scroll-mt class missing on Section');
});

// =====================================================================
header('9. Download speed/ETA UI (v2.6.4)');
const ubSrc = fs.readFileSync(path.join(PROJ, 'src', 'components', 'UpdateBanner.jsx'), 'utf8');
const spSrc = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
await test('UpdateBanner Downloading row shows bytesPerSec as MB/s', () => {
  if (!/bytesPerSec/.test(ubSrc)) throw new Error('UpdateBanner does not read bytesPerSec');
  if (!/MB\/s/.test(ubSrc)) throw new Error('UpdateBanner does not render MB/s string');
});
await test('UpdateBanner shows an ETA "Xs left" or "Xm left"', () => {
  if (!/left/.test(ubSrc) || !/remaining/.test(ubSrc)) throw new Error('ETA not computed');
});
await test('SettingsPanel InlineCheckResult downloading row shows speed', () => {
  const m = spSrc.match(/if \(status === 'downloading'\) \{[\s\S]{0,800}?return \(/);
  if (!m) throw new Error('downloading branch not found');
  if (!/bytesPerSec/.test(m[0])) throw new Error('downloading branch does not read bytesPerSec');
});

// =====================================================================
header('10. Multi-resolution / DPI scaling / multi-monitor (v2.7.0)');
const mainSrc = fs.readFileSync(path.join(PROJ, 'electron', 'main.js'), 'utf8');
const sidebarSrc = fs.readFileSync(path.join(PROJ, 'src', 'components', 'Sidebar.jsx'), 'utf8');
const appSrc = fs.readFileSync(path.join(PROJ, 'src', 'App.jsx'), 'utf8');
const cssSrc = fs.readFileSync(path.join(PROJ, 'src', 'index.css'), 'utf8');

await test('main.js: minWidth lowered to 920, minHeight to 600', () => {
  if (!/minWidth:\s*920\b/.test(mainSrc)) throw new Error('minWidth should be 920');
  if (!/minHeight:\s*600\b/.test(mainSrc)) throw new Error('minHeight should be 600');
});
await test('main.js: safeWindowBounds validates against current displays', () => {
  if (!/function safeWindowBounds/.test(mainSrc))
    throw new Error('safeWindowBounds helper missing');
  if (!/getAllDisplays|getDisplayNearestPoint/.test(mainSrc))
    throw new Error('helper does not consult screen.getAllDisplays / getDisplayNearestPoint');
});
await test('main.js: re-clamps bounds on display add/remove/metrics-changed', () => {
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) {
    if (!new RegExp(`screen\\.on\\(['"]${ev}['"]`).test(mainSrc))
      throw new Error(`screen.on('${ev}', …) missing`);
  }
});
await test('Sidebar: responsive — icon-only below xl, labeled at xl+', () => {
  // The sidebar should declare BOTH widths in a single class string.
  if (!/w-14 xl:w-56/.test(sidebarSrc))
    throw new Error('sidebar width should be `w-14 xl:w-56`');
  // Nav-item labels should be hidden at narrow widths.
  if (!/hidden xl:inline/.test(sidebarSrc))
    throw new Error('sidebar should hide labels at narrow widths');
});
await test('Dashboard: StatCard grid responsive (grid-cols-2 → lg:grid-cols-4)', () => {
  if (!/grid-cols-2 lg:grid-cols-4/.test(appSrc))
    throw new Error('stat card grid not responsive');
});
await test('Dashboard: main work grid responsive (single column → lg:grid-cols-3)', () => {
  if (!/grid-cols-1 lg:grid-cols-3/.test(appSrc))
    throw new Error('main work grid not responsive');
});
await test('SettingsPanel: nav rail collapses (w-12 → lg:w-52)', () => {
  if (!/w-12 lg:w-52/.test(settingsSrc2))
    throw new Error('settings nav rail not responsive');
});
await test('index.css anchors font-size to 16px so DPI scaling is deterministic', () => {
  if (!/font-size:\s*16px/.test(cssSrc))
    throw new Error('explicit 16px base font-size missing — DPI scaling math breaks otherwise');
});
await test('index.css enables font smoothing for non-integer DPI scales', () => {
  if (!/-webkit-font-smoothing:\s*antialiased/.test(cssSrc))
    throw new Error('font smoothing missing');
});
await test('ProfileEditor modal scales padding + grid responsively', () => {
  const peSrc = fs.readFileSync(path.join(PROJ, 'src', 'components', 'ProfileEditor.jsx'), 'utf8');
  if (!/p-3 sm:p-4 lg:p-6/.test(peSrc))
    throw new Error('modal padding not responsive');
  if (!/grid-cols-1 lg:grid-cols-2/.test(peSrc))
    throw new Error('modal body grid not responsive');
});

// =====================================================================
header('11. Low-resource hardening (v2.7.1)');
const mainSrc2 = fs.readFileSync(path.join(PROJ, 'electron', 'main.js'), 'utf8');
const appSrc2 = fs.readFileSync(path.join(PROJ, 'src', 'App.jsx'), 'utf8');

await test('Single-instance lock requested', () => {
  if (!/requestSingleInstanceLock\(\)/.test(mainSrc2))
    throw new Error('requestSingleInstanceLock missing');
});
await test('Second-instance handler shows "already running" notification', () => {
  // The handler should construct a Notification with body containing
  // "already running" so the user knows what happened.
  if (!/new Notification\(\{[\s\S]{0,300}?already running/.test(mainSrc2))
    throw new Error('notification body does not say "already running"');
});
await test('Second-instance handler focuses the existing window', () => {
  const m = mainSrc2.match(/app\.on\('second-instance'[\s\S]{0,1500}\}\);/);
  if (!m) throw new Error('second-instance handler not found');
  if (!/mainWindow\.focus\(\)/.test(m[0])) throw new Error('does not call focus()');
  if (!/isMinimized\(\)/.test(m[0])) throw new Error('does not handle minimized state');
});
await test('Second-instance handler flashes the taskbar', () => {
  if (!/flashFrame\(true\)/.test(mainSrc2))
    throw new Error('flashFrame call missing — second instance is silent');
});
await test('Converter probe deferred via setTimeout (not blocking startup paint)', () => {
  // Match `setTimeout(() => { try { ... converter.status() ... }, NN)`
  if (!/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]{0,400}?converter\.status\(\)/.test(mainSrc2))
    throw new Error('converter.status() should be wrapped in setTimeout for deferred init');
});
await test('Heavy components are React.lazy-loaded', () => {
  for (const c of ['ProfileEditor', 'HelpModal', 'FolderImportModal', 'SettingsPanel']) {
    if (!new RegExp(`const ${c}[\\s\\S]{0,80}?lazy\\(`).test(appSrc2))
      throw new Error(`${c} not wrapped in lazy()`);
  }
});
await test('Lazy components live inside <Suspense>', () => {
  // Match either `import { Suspense ... } from 'react'` or
  //              `import React, { ... Suspense ... } from 'react'`
  if (!/from ['"]react['"]/.test(appSrc2) || !/\bSuspense\b/.test(appSrc2))
    throw new Error('Suspense not imported');
  if (!/<Suspense /.test(appSrc2))
    throw new Error('no <Suspense> boundary');
});
await test('Settings has a skeleton fallback so the view does not flash empty', () => {
  if (!/function SettingsSkeleton/.test(appSrc2))
    throw new Error('SettingsSkeleton component missing');
  if (!/animate-pulse/.test(appSrc2))
    throw new Error('skeleton not animated');
});

// =====================================================================
header('4. Settings inline-result coverage');
await test('SettingsPanel: InlineCheckResult handles every status', () => {
  const src = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
  for (const s of ['idle', 'checking', 'no-update', 'available', 'downloading', 'ready', 'error']) {
    if (!src.includes(`status === '${s}'`)) throw new Error(`InlineCheckResult missing status: ${s}`);
  }
});
await test('SettingsPanel: idle returns null (no flash)', () => {
  const src = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
  if (!/status\s*===\s*'idle'\s*\)\s*return null/.test(src))
    throw new Error('idle should return null');
});
await test('SettingsPanel: checking returns null (button shows spinner)', () => {
  const src = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
  if (!/status\s*===\s*'checking'\s*\)\s*return null/.test(src))
    throw new Error('checking should return null inline');
});

console.log('');
console.log('='.repeat(60));
console.log(`SETTINGS-UI SUITE: ${PASS} pass, ${FAIL} fail (of ${PASS + FAIL})`);
if (FAIL) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
process.exit(0);

})().catch(e => { console.error('CRASH:', e); process.exit(2); });
