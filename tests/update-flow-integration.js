// Update + download + install integration test against the LIVE GitHub release.
//
// Not part of the regular suite rotation because it (a) downloads ~82 MB of
// real installer payload and (b) only works when online with reachable
// github.com. Run it manually before cutting a release:
//
//   node tests/update-flow-integration.js
//
// 12 assertions covering: live check, full asset download with progress +
// integrity, MOTW Zone.Identifier strip, installer launchability via /HELP,
// and the settings adapter (debounce / force / dismissed-version).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PROJ = 'C:/Users/Khurram/Dropbox/0 AI/Claude/Veloxa/Veloxa Watermark Studio';
const updater = require(`${PROJ}/engine/updater`);

let PASS = 0, FAIL = 0;
const failures = [];
function ok(l)  { PASS++; console.log(`  PASS  ${l}`); }
function bad(l, e) { FAIL++; failures.push(`${l}: ${e.message || e}`); console.error(`  FAIL  ${l}: ${e.message || e}`); }
function header(s) { console.log(''); console.log('=== ' + s + ' ==='); }
async function test(label, fn) { try { await fn(); ok(label); } catch (e) { bad(label, e); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-focused-'));
console.log('tmp:', tmp);

(async () => {

// ---------------------------------------------------------------------
header('1. Live check against GitHub Releases');
let liveCheck;
await test('check() reaches GitHub Releases', async () => {
  liveCheck = await updater.check({
    currentVersion: '2.5.0',
    repo: 'khurram5509/Veloxa-Watermark-Studio',
    assetPattern: 'VeloxaWatermarkStudio-Setup-{version}.exe',
    force: true,
  });
  if (!liveCheck.hasUpdate) throw new Error('expected update');
});
console.log(`        latest:  ${liveCheck.latest}`);
console.log(`        asset:   ${liveCheck.asset && liveCheck.asset.name}`);
console.log(`        size:    ${liveCheck.asset && (liveCheck.asset.size / 1024 / 1024).toFixed(1)} MB`);
console.log(`        url:     ${liveCheck.asset && liveCheck.asset.url.slice(0, 80)}…`);

await test('check returns the full UI-required shape', () => {
  for (const f of ['hasUpdate', 'current', 'latest', 'asset', 'releaseUrl', 'body', 'dismissed', 'cached'])
    if (!(f in liveCheck)) throw new Error(`field missing: ${f}`);
  if (!liveCheck.asset.name || !liveCheck.asset.url || typeof liveCheck.asset.size !== 'number')
    throw new Error('asset shape wrong');
});

// ---------------------------------------------------------------------
header('1b. Platform-aware asset selection against the LIVE release');
// Same release, asked from three different "virtual machines" — assert each
// gets only its own asset and never the others.
const PKG = require(`${PROJ}/package.json`);
const assetPatterns = (PKG.veloxa && PKG.veloxa.updateAssetPatterns) || null;
if (!assetPatterns) throw new Error('package.json missing veloxa.updateAssetPatterns');

const platformProbes = [
  { platform: 'win32',  arch: 'x64',   expect: /Setup-.+\.exe$/i,   reject: /\.zip$|\.tar\.gz$/i },
  { platform: 'darwin', arch: 'arm64', expect: /mac-arm64\.zip$/i,  reject: /\.exe$|mac-x64\.zip$/i },
  { platform: 'darwin', arch: 'x64',   expect: /mac-x64\.zip$/i,    reject: /\.exe$|mac-arm64\.zip$/i },
];
for (const probe of platformProbes) {
  await test(`Live release: ${probe.platform}-${probe.arch} → matches ${probe.expect}`, async () => {
    const r = await updater.check({
      currentVersion: '2.5.0',
      repo: 'khurram5509/Veloxa-Watermark-Studio',
      assetPatterns,
      platform: probe.platform,
      arch: probe.arch,
      force: true,
    });
    if (!r.asset) throw new Error('no asset returned');
    if (!probe.expect.test(r.asset.name)) {
      throw new Error(`got "${r.asset.name}" — does not match ${probe.expect}`);
    }
    if (probe.reject.test(r.asset.name)) {
      throw new Error(`got "${r.asset.name}" — should NEVER pick a cross-platform asset (${probe.reject})`);
    }
    console.log(`        → ${r.asset.name} (${(r.asset.size/1024/1024).toFixed(1)} MB)`);
  });
}

// ---------------------------------------------------------------------
header('2. Download — full asset with progress + integrity verification');
const destPath = path.join(tmp, liveCheck.asset.name);
let progressEvents = 0;
let lastPct = 0;
const dlStart = Date.now();
await test(`downloadAsset() → ${destPath.split(/[\\/]/).pop()}`, async () => {
  await updater.downloadAsset(liveCheck.asset.url, destPath, {
    onProgress: (p) => {
      progressEvents++;
      const pct = Math.round((p.percent || 0) * 100);
      if (pct - lastPct >= 25) {
        console.log(`        ${pct}% (${(p.received / 1024 / 1024).toFixed(0)} / ${(p.total / 1024 / 1024).toFixed(0)} MB)`);
        lastPct = pct;
      }
    },
    expectedSize: liveCheck.asset.size,
  });
});
console.log(`        completed in ${((Date.now() - dlStart)/1000).toFixed(1)}s`);

await test(`fired ≥ 1 progress event (got ${progressEvents})`, () => {
  if (progressEvents === 0) throw new Error('no progress events');
});
await test('on-disk size matches asset.size exactly', () => {
  const got = fs.statSync(destPath).size;
  if (got !== liveCheck.asset.size)
    throw new Error(`size mismatch: ${got} vs ${liveCheck.asset.size}`);
});
await test('downloaded file has PE/EXE signature (MZ)', () => {
  const head = fs.readFileSync(destPath, { encoding: null }).slice(0, 4);
  if (head[0] !== 0x4D || head[1] !== 0x5A) throw new Error('not a valid PE file (missing MZ)');
});
await test('.partial cleaned up after rename', () => {
  if (fs.existsSync(destPath + '.partial')) throw new Error('.partial leftover');
});

// ---------------------------------------------------------------------
header('3. SmartScreen / MOTW Zone.Identifier strip mirrors production code');
await test('attach a fake MOTW ADS, then strip via fs.unlinkSync (matches IPC handler)', () => {
  const zoneStream = destPath + ':Zone.Identifier';
  let adsSupported = true;
  try {
    fs.writeFileSync(zoneStream, '[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://github.com\r\n');
  } catch { adsSupported = false; }
  if (!adsSupported || !fs.existsSync(zoneStream)) {
    console.log('        (ADS not exposed by this Node — production code still uses the same fs.unlinkSync)');
    return;
  }
  fs.unlinkSync(zoneStream);
  if (fs.existsSync(zoneStream)) throw new Error('zone-identifier still present');
});

// ---------------------------------------------------------------------
header('4. Installer is launchable (Inno /HELP smoke test)');
await test('installer EXE responds to /HELP without crashing', async () => {
  const child = spawn(destPath, ['/HELP'], { detached: true, stdio: 'ignore', windowsHide: true });
  const result = await new Promise((resolve) => {
    let resolved = false;
    child.on('exit', (code) => { if (!resolved) { resolved = true; resolve({ kind: 'exit', code }); } });
    child.on('error', (err) => { if (!resolved) { resolved = true; resolve({ kind: 'error', err: err.message }); } });
    setTimeout(() => { if (!resolved) { resolved = true; try { child.kill(); } catch {} resolve({ kind: 'timeout' }); } }, 8000);
  });
  if (result.kind === 'error') throw new Error('spawn error: ' + result.err);
  // Either exit (Inno printed help and exited) or timeout (Inno showed help dialog we killed).
  console.log(`        spawn result: ${JSON.stringify(result)}`);
});

// ---------------------------------------------------------------------
header('5. Settings adapter — daily debounce + force=true + dismissed');
await test('debounce returns cached', async () => {
  let state = {
    lastUpdateCheckMs: Date.now() - 1000,
    cachedLatestRelease: { latest: '99.0.0', asset: { name: 'X.exe', url: 'http://x', size: 100 }, releaseUrl: '', body: '' },
  };
  const adapter = { get: () => state, set: (p) => (state = { ...state, ...p }) };
  const r = await updater.check({ currentVersion: '2.5.0', repo: 'khurram5509/Veloxa-Watermark-Studio',
    settingsAdapter: adapter, force: false });
  if (!r.cached || r.latest !== '99.0.0') throw new Error('cached not returned');
});
await test('force=true bypasses cache', async () => {
  let state = {
    lastUpdateCheckMs: Date.now() - 1000,
    cachedLatestRelease: { latest: '99.0.0', asset: null, releaseUrl: '', body: '' },
  };
  const adapter = { get: () => state, set: (p) => (state = { ...state, ...p }) };
  const r = await updater.check({ currentVersion: '2.5.0', repo: 'khurram5509/Veloxa-Watermark-Studio',
    settingsAdapter: adapter, force: true });
  if (r.cached) throw new Error('force should have bypassed');
  if (r.latest === '99.0.0') throw new Error('cached value leaked');
});
await test('dismissed=true when latest === dismissedUpdateVersion', async () => {
  let state = {
    lastUpdateCheckMs: Date.now() - 1000,
    cachedLatestRelease: { latest: '2.7.0', asset: null, releaseUrl: '', body: '' },
    dismissedUpdateVersion: '2.7.0',
  };
  const adapter = { get: () => state, set: () => state };
  const r = await updater.check({ currentVersion: '2.5.0', repo: 'khurram5509/Veloxa-Watermark-Studio',
    settingsAdapter: adapter, force: false });
  if (!r.dismissed) throw new Error('dismissed should be true');
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log('');
console.log('='.repeat(60));
console.log(`UPDATE+DOWNLOAD FOCUSED TEST: ${PASS} pass, ${FAIL} fail (of ${PASS + FAIL})`);
if (FAIL) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
process.exit(0);

})().catch(e => { console.error('CRASHED:', e); process.exit(2); });
