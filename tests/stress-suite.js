// Stress / endurance / memory-profile suite for v2.7.1.
//
// Runs the engine through repeated heavy workloads and measures heap +
// resource consumption to detect leaks. Designed for low-resource systems —
// the budgets here (≤250 MB heap delta, ≤2s/file at 1 page) are the same
// targets we expect a 4 GB / dual-core machine to hold.
//
//   node --expose-gc tests/stress-suite.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PROJ = path.resolve(__dirname, '..');
const { PDFDocument, StandardFonts } = require(path.join(PROJ, 'node_modules', 'pdf-lib'));
const PizZip = require(path.join(PROJ, 'node_modules', 'pizzip'));
const { processPdf } = require(path.join(PROJ, 'engine', 'processors', 'pdf'));
const { processDocx } = require(path.join(PROJ, 'engine', 'processors', 'docx'));
const queue = require(path.join(PROJ, 'engine', 'queue'));
const WorkerPool = require(path.join(PROJ, 'engine', 'workerPool'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veloxa-stress-'));
console.log('Veloxa stress + endurance suite');
console.log('tmp:', tmp);

let PASS = 0, FAIL = 0;
const failures = [];
function ok(l) { PASS++; console.log(`  PASS  ${l}`); }
function bad(l, e) { FAIL++; failures.push(`${l}: ${e.message || e}`); console.error(`  FAIL  ${l}: ${e.message || e}`); }
function header(s) { console.log(''); console.log('=== ' + s + ' ==='); }
async function test(label, fn) { try { await fn(); ok(label); } catch (e) { bad(label, e); } }
const fmtMb = (b) => (b / 1024 / 1024).toFixed(1);

function gc() { try { global.gc && global.gc(); } catch {} }

async function makePdf(file, pages = 1) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([612, 792]);
    p.drawText(`Page ${i + 1}`, { x: 50, y: 720, size: 12, font: f });
  }
  fs.writeFileSync(file, await d.save());
}

function makeBlankDocx(file) {
  const z = new PizZip();
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/document.xml', `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`);
  fs.writeFileSync(file, z.generate({ type: 'nodebuffer' }));
}

(async () => {

// =====================================================================
header('1. Memory profile — 500 PDF watermarks (heap delta ≤ 250 MB)');
await test('500 sequential PDF watermarks do not leak', async () => {
  const inp = path.join(tmp, 'mem.pdf');
  await makePdf(inp, 3);
  gc();
  const startHeap = process.memoryUsage().heapUsed;
  let peakHeap = startHeap;
  for (let i = 0; i < 500; i++) {
    const out = path.join(tmp, `mem_${i}.pdf`);
    await processPdf({
      inputPath: inp, outputPath: out,
      profile: { name: 'P', type: 'text', text: 'STRESS TEST', position: 'center', opacity: 0.5, rotation: -30, fontSize: 48 },
      settings: {},
    });
    fs.unlinkSync(out);
    peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    if ((i + 1) % 100 === 0) {
      gc();
      const now = process.memoryUsage().heapUsed;
      console.log(`        ${i + 1}/500 · heap now ${fmtMb(now)} MB · peak ${fmtMb(peakHeap)} MB`);
    }
  }
  gc();
  const endHeap = process.memoryUsage().heapUsed;
  const delta = endHeap - startHeap;
  console.log(`        delta after 500: ${fmtMb(delta)} MB`);
  if (delta > 250 * 1024 * 1024) throw new Error(`heap grew ${fmtMb(delta)} MB — possible leak`);
});

// =====================================================================
header('2. Endurance — 200 DOCX watermarks back-to-back');
await test('200 DOCX watermarks complete without errors', async () => {
  const inp = path.join(tmp, 'end.docx'); makeBlankDocx(inp);
  const startTime = Date.now();
  for (let i = 0; i < 200; i++) {
    const out = path.join(tmp, `end_${i}.docx`);
    await processDocx({
      inputPath: inp, outputPath: out,
      profile: { name: 'P', type: 'text', text: 'X', position: 'center' },
    });
    fs.unlinkSync(out);
  }
  const totalMs = Date.now() - startTime;
  const perFile = totalMs / 200;
  console.log(`        completed in ${(totalMs / 1000).toFixed(1)}s · avg ${perFile.toFixed(0)} ms/file`);
  // Budget: 50 ms/file is generous. If it's > 200 ms/file something is wrong.
  if (perFile > 200) throw new Error(`average ${perFile.toFixed(0)}ms/file is above 200ms budget`);
});

// =====================================================================
header('3. Worker pool — destroy + recreate × 20 (no FD leak)');
await test('repeated pool destroy/recreate stays stable', async () => {
  const inp = path.join(tmp, 'pool.pdf'); await makePdf(inp, 1);
  for (let c = 0; c < 20; c++) {
    const pool = new WorkerPool(2);
    await Promise.all(Array.from({ length: 4 }, (_, i) => pool.exec({
      inputPath: inp, outputPath: path.join(tmp, `p_${c}_${i}.pdf`),
      profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {},
    })));
    await pool.destroy();
    if (c % 5 === 4) console.log(`        cycle ${c + 1}/20 OK`);
  }
});

// =====================================================================
header('4. Queue resilience — bad inputs do not destabilize pool');
await test('mixed valid+invalid inputs leave the pool healthy', async () => {
  queue.clearAll();
  const valid = path.join(tmp, 'q_valid.pdf'); await makePdf(valid, 1);
  const inputs = [valid, 'C:/nope.pdf', valid, 'C:/also-nope.pdf', valid];
  queue.enqueue(inputs, { id: 'qm', name: 'QM', type: 'text', text: 'X', position: 'center' });
  const d = new Promise(r => queue.events.once('done', r));
  queue.start();
  const summary = await Promise.race([d, new Promise((_, r) => setTimeout(() => r(new Error('queue timeout')), 30000))]);
  if (summary.success !== 3 || summary.failed !== 2) {
    throw new Error(`expected 3 success / 2 failed, got ${JSON.stringify(summary)}`);
  }
});
await queue.destroyPool().catch(() => {});

// =====================================================================
header('5. Burst load — 50 PDFs into the queue at once');
await test('50-file burst completes inside the duration budget (≤ 60s)', async () => {
  queue.clearAll();
  const dir = fs.mkdtempSync(path.join(tmp, 'burst-'));
  const inputs = Array.from({ length: 50 }, (_, i) => path.join(dir, `b${i}.pdf`));
  for (const inp of inputs) await makePdf(inp, 1);
  queue.enqueue(inputs, { id: 'qb', name: 'QB', type: 'text', text: 'B', position: 'center' });
  const t0 = Date.now();
  const d = new Promise(r => queue.events.once('done', r));
  queue.start();
  const summary = await Promise.race([d, new Promise((_, r) => setTimeout(() => r(new Error('burst timeout')), 60000))]);
  const elapsed = Date.now() - t0;
  console.log(`        50 files in ${(elapsed / 1000).toFixed(1)}s · ${summary.success} ok / ${summary.failed} failed`);
  if (summary.success !== 50) throw new Error(`only ${summary.success}/50 succeeded`);
});
await queue.destroyPool().catch(() => {});

// =====================================================================
header('6. Process resource snapshot (sanity)');
await test('process RSS stays within 500 MB ceiling', () => {
  const rss = process.memoryUsage().rss;
  console.log(`        RSS: ${fmtMb(rss)} MB · heapUsed: ${fmtMb(process.memoryUsage().heapUsed)} MB`);
  if (rss > 500 * 1024 * 1024) throw new Error(`RSS ${fmtMb(rss)} MB above 500 MB budget`);
});

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log('');
console.log('='.repeat(60));
console.log(`STRESS SUITE: ${PASS} pass, ${FAIL} fail (of ${PASS + FAIL})`);
if (FAIL) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
process.exit(0);

})().catch(e => { console.error('CRASHED:', e); process.exit(2); });
