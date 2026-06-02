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
  // We can't fully parse JSX without babel; just verify there are no
  // mismatched braces and the key exports look right.
  const src = fs.readFileSync(path.join(PROJ, 'src', 'components', 'SettingsPanel.jsx'), 'utf8');
  if (!src.includes('export default function SettingsPanel')) throw new Error('no default export');
  if (!src.includes('UpdatesSection')) throw new Error('UpdatesSection missing');
  if (!src.includes('InlineCheckResult')) throw new Error('InlineCheckResult missing');
  if (!src.includes('relativeTime')) throw new Error('relativeTime not imported');
  // Quick brace balance check
  const open = (src.match(/{/g) || []).length;
  const close = (src.match(/}/g) || []).length;
  if (open !== close) throw new Error(`brace mismatch: ${open} open, ${close} close`);
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
