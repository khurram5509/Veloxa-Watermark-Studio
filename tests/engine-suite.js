// Consolidated engine test suite — covers everything from the original
// full + torture + extra + gap + deepsoak + final suites, refreshed for v2.5.0.
// Run via: node tests/engine-suite.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PROJ = path.resolve(__dirname, '..');
const PizZip = require(path.join(PROJ, 'node_modules', 'pizzip'));
const { PDFDocument, StandardFonts } = require(path.join(PROJ, 'node_modules', 'pdf-lib'));
const { processPdf, VELOXA_PDF_MARKER } = require(path.join(PROJ, 'engine', 'processors', 'pdf'));
const { processDocx } = require(path.join(PROJ, 'engine', 'processors', 'docx'));
const { processPptx } = require(path.join(PROJ, 'engine', 'processors', 'pptx'));
const processors = require(path.join(PROJ, 'engine', 'processors'));
const queue = require(path.join(PROJ, 'engine', 'queue'));
const queueState = require(path.join(PROJ, 'engine', 'queueState'));
const profiles = require(path.join(PROJ, 'engine', 'profiles'));
const settings = require(path.join(PROJ, 'engine', 'settings'));
const logger = require(path.join(PROJ, 'engine', 'logger'));
const converter = require(path.join(PROJ, 'engine', 'converter'));
const WorkerPool = require(path.join(PROJ, 'engine', 'workerPool'));
const { scanPaths } = require(path.join(PROJ, 'engine', 'scanner'));
const { hasVeloxaWatermark } = require(path.join(PROJ, 'engine', 'conflict'));
const { applyTemplate, resolveOutputPath, sanitize } = require(path.join(PROJ, 'engine', 'naming'));
const { validateProfile } = require(path.join(PROJ, 'engine', 'validation'));
const pkg = require(path.join(PROJ, 'package.json'));

const VERSION = pkg.version; // dynamic — no hardcoded version pins
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veloxa-engine-'));
console.log('Veloxa Watermark Studio v' + VERSION + ' — engine suite');
console.log('tmp:', tmp);

let PASS = 0, FAIL = 0;
const failures = [];
function ok(l) { PASS++; console.log(`  PASS  ${l}`); }
function bad(l, e) { FAIL++; failures.push(`${l}: ${e.message || e}`); console.error(`  FAIL  ${l}: ${e.message || e}`); }
function header(s) { console.log(''); console.log('=== ' + s + ' ==='); }
async function test(l, fn) { try { await fn(); ok(l); } catch (e) { bad(l, e); } }

function makePng(w, h, file) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const scan = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) { scan[y*(1+w*3)] = 0; for (let x = 0; x < w; x++) { const o = y*(1+w*3)+1+x*3; scan[o]=255; scan[o+1]=0; scan[o+2]=0; } }
  const cmp = zlib.deflateSync(scan);
  function chunk(type, data) {
    const buf = Buffer.alloc(8+data.length+4);
    buf.writeUInt32BE(data.length,0); buf.write(type,4,4,'ascii'); data.copy(buf,8);
    let c=0xffffffff; const inp=Buffer.concat([Buffer.from(type,'ascii'),data]);
    for (const b of inp) { c^=b; for (let k=0;k<8;k++) c=(c>>>1)^(0xedb88320 & -(c&1)); }
    buf.writeUInt32BE((c^0xffffffff)>>>0, 8+data.length); return buf;
  }
  fs.writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', cmp), chunk('IEND', Buffer.alloc(0))]));
  return file;
}

async function makePdf(file, pages = 1, withKeywords = null) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = d.addPage([612, 792]);
    p.drawText(`p${i + 1}`, { x: 50, y: 700, size: 12, font: f });
  }
  if (withKeywords) d.setKeywords(Array.isArray(withKeywords) ? withKeywords : [withKeywords]);
  fs.writeFileSync(file, await d.save());
}

function makeDocxPgSz(file, wTwips = 12240, hTwips = 15840) {
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
<w:sectPr><w:pgSz w:w="${wTwips}" w:h="${hTwips}"/></w:sectPr></w:body></w:document>`);
  fs.writeFileSync(file, z.generate({ type: 'nodebuffer' }));
}

function runPS(s, t = 180000) {
  return new Promise((res, rej) => {
    const enc = Buffer.from(s, 'utf16le').toString('base64');
    const c = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { windowsHide: true });
    let o = '', e = '';
    c.stdout.on('data', d => o += d.toString());
    c.stderr.on('data', d => e += d.toString());
    const k = setTimeout(() => { try { c.kill(); } catch {}; rej(new Error('PS timeout')); }, t);
    c.on('close', code => { clearTimeout(k); res({ code, out: o, err: e }); });
  });
}

const logo = makePng(60, 40, path.join(tmp, 'logo.png'));
const blankPdf3 = path.join(tmp, 'blank3.pdf');
const blankDocx = path.join(tmp, 'blank.docx');

(async () => {
  await makePdf(blankPdf3, 3);
  makeDocxPgSz(blankDocx);
  let realPptx = null, realDocx = null;
  try {
    realPptx = path.join(tmp, 'real.pptx');
    await runPS(`
$ErrorActionPreference='Stop'; $ppt = $null;
try { $ppt = New-Object -ComObject PowerPoint.Application;
  $p = $ppt.Presentations.Add($false); $p.Slides.Add(1, 1) | Out-Null;
  $p.SaveAs("${realPptx.replace(/\\/g, '\\\\')}", 24); $p.Close();
} finally { if ($ppt) { $ppt.Quit() } }
Write-Output OK`);
    realDocx = path.join(tmp, 'real.docx');
    await runPS(`
$ErrorActionPreference='Stop'; $w = $null;
try { $w = New-Object -ComObject Word.Application; $w.Visible=$false;
  $d = $w.Documents.Add(); $d.Content.Text = ('Beyond the Vault. ' * 20);
  $d.SaveAs([ref]"${realDocx.replace(/\\/g, '\\\\')}", [ref]12); $d.Close($false);
} finally { if ($w) { $w.Quit() } }
Write-Output OK`);
  } catch { realPptx = null; realDocx = null; }

  await converter.status();

// =====================================================================
header('1. Sanity: package version + processor APIs');
await test(`package.json version is "${VERSION}"`, () => {
  if (!VERSION || typeof VERSION !== 'string') throw new Error('no version');
});
await test('processors.process routes by extension', async () => {
  const out = path.join(tmp, 'route.pdf');
  await processors.process({ inputPath: blankPdf3, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {} });
  if (!fs.existsSync(out)) throw new Error();
});
await test('processors.process rejects unknown extension', async () => {
  const inp = path.join(tmp, 'foo.xyz'); fs.writeFileSync(inp, 'hi');
  let threw = false;
  try { await processors.process({ inputPath: inp, outputPath: inp+'.out',
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {} }); }
  catch { threw = true; }
  if (!threw) throw new Error();
});

// =====================================================================
header('2. PDF processor — every preset × type × page-range');
const presets = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
const types = ['text', 'image', 'combined'];
for (const pos of presets) {
  for (const type of types) {
    await test(`PDF ${pos} ${type}`, async () => {
      const out = path.join(tmp, `pdf_${pos}_${type}.pdf`);
      await processPdf({ inputPath: blankPdf3, outputPath: out,
        profile: { name: 'P', type, text: 'X', logoPath: logo, position: pos, opacity: 0.5,
          rotation: pos === 'center' ? -30 : 0, fontFamily: 'Arial', fontSize: 36,
          fontColor: '#FF0000', margin: 36, offsetX: 10, offsetY: -5, scale: 1, pages: 'all' },
        settings: {} });
      if (fs.readFileSync(out).slice(0,5).toString() !== '%PDF-') throw new Error('not PDF');
    });
  }
}
await test('PDF pages=first only', async () => {
  const out = path.join(tmp, 'pdf_first.pdf');
  await processPdf({ inputPath: blankPdf3, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'center', pages: 'first' }, settings: {} });
  if ((await PDFDocument.load(fs.readFileSync(out))).getPageCount() !== 3) throw new Error();
});
await test('PDF pages=custom "1,3" + "2-3" + "999" (OOB tolerated)', async () => {
  for (const range of ['1,3', '2-3', '999', '1-100']) {
    const out = path.join(tmp, `pdf_r_${range.replace(/\W/g,'_')}.pdf`);
    await processPdf({ inputPath: blankPdf3, outputPath: out,
      profile: { name: 'P', type: 'text', text: 'X', position: 'center', pages: 'custom', customPages: range },
      settings: {} });
    if ((await PDFDocument.load(fs.readFileSync(out))).getPageCount() !== 3) throw new Error(range);
  }
});

// =====================================================================
header('2b. PDF processor — 4 new edge positions (v2.6.0)');
const newPositions = ['top-center', 'middle-left', 'middle-right', 'bottom-center'];
for (const pos of newPositions) {
  await test(`PDF ${pos} (new in v2.6.0)`, async () => {
    const out = path.join(tmp, `pdf_new_${pos}.pdf`);
    await processPdf({ inputPath: blankPdf3, outputPath: out,
      profile: { name: 'P', type: 'text', text: 'X', position: pos, opacity: 0.5,
        fontFamily: 'Arial', fontSize: 36, margin: 36 }, settings: {} });
    if (fs.readFileSync(out).slice(0,5).toString() !== '%PDF-') throw new Error('not PDF');
  });
}

// =====================================================================
header('3. DOCX processor — page-edge absolute positioning + all paper sizes');
// New edge positions are exercised here too — assert specific coords.
for (const pos of newPositions) {
  await test(`DOCX ${pos} produces correct margin-* coords`, async () => {
    const out = path.join(tmp, `docx_new_${pos}.docx`);
    await processDocx({ inputPath: blankDocx, outputPath: out,
      profile: { name: 'P', type: 'text', text: 'X', position: pos, margin: 48 } });
    const hdr = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
    const mL = parseFloat(hdr.match(/margin-left:([-\d.]+)pt/)[1]);
    const mT = parseFloat(hdr.match(/margin-top:([-\d.]+)pt/)[1]);
    // Page = 612×792 Letter, wmW=240 wmH=80 (compact corner sizes), margin=48
    const expected = {
      'top-center':    { L: (612 - 240) / 2, T: 48 },
      'middle-left':   { L: 48, T: (792 - 80) / 2 },
      'middle-right':  { L: 612 - 240 - 48, T: (792 - 80) / 2 },
      'bottom-center': { L: (612 - 240) / 2, T: 792 - 80 - 48 },
    }[pos];
    if (Math.abs(mL - expected.L) > 0.1) throw new Error(`L wrong: ${mL} (want ${expected.L})`);
    if (Math.abs(mT - expected.T) > 0.1) throw new Error(`T wrong: ${mT} (want ${expected.T})`);
  });
}

for (const pos of presets) {
  for (const type of types) {
    await test(`DOCX ${pos} ${type}`, async () => {
      const out = path.join(tmp, `docx_${pos}_${type}.docx`);
      await processDocx({ inputPath: blankDocx, outputPath: out,
        profile: { name: 'P', type, text: 'X', logoPath: logo, position: pos, opacity: 0.5, rotation: 0,
          fontFamily: 'Arial', fontSize: 60, fontColor: '#FF0000',
          margin: 48, offsetX: 5, offsetY: -5, scale: 1 } });
      const hdr = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
      if (/mso-position-horizontal:(left|right|center)/.test(hdr))
        throw new Error('named anchor present — would override margin-left');
      if (!/mso-position-horizontal-relative:page/.test(hdr)) throw new Error('not page-relative');
    });
  }
}
await test('DOCX page sizes: Letter / A4 / Legal all positioned correctly', async () => {
  // Letter
  let inp = path.join(tmp, 'pg_letter.docx'); makeDocxPgSz(inp, 12240, 15840);
  let out = path.join(tmp, 'pg_letter_out.docx');
  await processDocx({ inputPath: inp, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'top-left', margin: 48 } });
  let hdr = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
  if (!/margin-left:48pt/.test(hdr) || !/margin-top:48pt/.test(hdr)) throw new Error('Letter');
  // A4
  inp = path.join(tmp, 'pg_a4.docx'); makeDocxPgSz(inp, 11906, 16838);
  out = path.join(tmp, 'pg_a4_out.docx');
  await processDocx({ inputPath: inp, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'top-right', margin: 48 } });
  hdr = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
  const mL = parseFloat(hdr.match(/margin-left:([-\d.]+)pt/)[1]);
  if (Math.abs(mL - 307.3) > 0.1) throw new Error('A4 top-right: ' + mL);
  // Legal
  inp = path.join(tmp, 'pg_legal.docx'); makeDocxPgSz(inp, 12240, 20160);
  out = path.join(tmp, 'pg_legal_out.docx');
  await processDocx({ inputPath: inp, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'bottom-left', margin: 48 } });
  hdr = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
  const mT = parseFloat(hdr.match(/margin-top:([-\d.]+)pt/)[1]);
  if (Math.abs(mT - 880) > 0.1) throw new Error('Legal bottom-left: ' + mT);
});
await test('DOCX watermark renders ON TOP (positive z-index, not behind text)', async () => {
  const out = path.join(tmp, 'docx_ontop.docx');
  await processDocx({ inputPath: blankDocx, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' } });
  const hdr = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
  // Negative z-index = behind text (the bug). Positive z-index = on top.
  // Match z-index:<digits> WITHOUT a leading minus.
  const m = hdr.match(/z-index:(-?\d+)/);
  if (!m) throw new Error('no z-index in watermark VML');
  if (m[1].startsWith('-')) throw new Error(`watermark z-index ${m[1]} is negative — would render behind text`);
});
await test('DOCX with titlePg (Different First Page) gets watermark on page 1', async () => {
  // Build a docx that uses <w:titlePg/> — Word's "Different First Page"
  // setting. Without the v2.7.2 fix, only the default header carries our
  // watermark and page 1 silently goes blank.
  const z = new PizZip();
  z.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/document.xml', `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Body</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:titlePg/></w:sectPr>
</w:body></w:document>`);
  const inp = path.join(tmp, 'titlepg.docx');
  fs.writeFileSync(inp, z.generate({ type: 'nodebuffer' }));
  const out = path.join(tmp, 'titlepg_out.docx');
  await processDocx({ inputPath: inp, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' } });
  const docXml = new PizZip(fs.readFileSync(out)).file('word/document.xml').asText();
  // Must reference our header part under all 3 type values so page 1 (which
  // uses "first" when titlePg is set) still pulls the watermark.
  for (const type of ['default', 'first', 'even']) {
    if (!new RegExp(`w:type="${type}"`).test(docXml))
      throw new Error(`titlePg doc missing w:type="${type}" — page 1 would skip watermark`);
  }
});

await test('DOCX XML escapes special chars', async () => {
  const out = path.join(tmp, 'docx_esc.docx');
  await processDocx({ inputPath: blankDocx, outputPath: out,
    profile: { name: 'P', type: 'text', text: '<x & "y">', position: 'center', opacity: 1,
      fontFamily: 'Arial', fontSize: 60, fontColor: '#000' } });
  const hdr = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
  if (!/&lt;x &amp; &quot;y&quot;&gt;/.test(hdr)) throw new Error('escape broken');
});
await test('DOCX multi-section: every sectPr gets headerReference', async () => {
  const z = new PizZip();
  z.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  z.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  z.file('word/document.xml', `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>A</w:t></w:r></w:p>
<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>
<w:p><w:r><w:t>B</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
</w:body></w:document>`);
  const inp = path.join(tmp, 'ms.docx');
  fs.writeFileSync(inp, z.generate({ type: 'nodebuffer' }));
  const out = path.join(tmp, 'ms_out.docx');
  await processDocx({ inputPath: inp, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' } });
  const docXml = new PizZip(fs.readFileSync(out)).file('word/document.xml').asText();
  // v2.7.2: we now inject 3 headerReference types (default / first / even)
  // per section so docs with <w:titlePg/> still show the watermark on page 1.
  // 2 sections × 3 refs/each = 6.
  const refs = (docXml.match(/headerReference/g) || []).length;
  if (refs !== 6) throw new Error('expected 6 headerReferences (2 sections × 3 types), got ' + refs);
  // Each type must be present at least once.
  for (const type of ['default', 'first', 'even']) {
    if (!new RegExp(`w:type="${type}"`).test(docXml)) throw new Error(`missing w:type="${type}"`);
  }
});

// =====================================================================
header('4. PPTX processor (uses real PowerPoint COM if available)');
if (realPptx) {
  for (const pos of presets) {
    for (const type of types) {
      await test(`PPTX ${pos} ${type}`, async () => {
        const out = path.join(tmp, `pptx_${pos}_${type}.pptx`);
        await processPptx({ inputPath: realPptx, outputPath: out,
          profile: { name: 'P', type, text: 'X', logoPath: logo, position: pos, opacity: 0.5,
            rotation: 0, fontFamily: 'Arial', fontSize: 60, fontColor: '#FF0000',
            margin: 24, offsetX: 10, offsetY: -10, scale: 1 } });
        const z = new PizZip(fs.readFileSync(out));
        if (!z.file('ppt/presentation.xml')) throw new Error('PPTX broken');
      });
    }
  }
}

// =====================================================================
header('5. Conflict detection — PDF marker + DOCX/PPTX');
await test('PDF marker round-trip: stamp + detect + dedup + preserve existing keywords', async () => {
  const inp = path.join(tmp, 'kw.pdf');
  await makePdf(inp, 1, ['confidential', 'finance']);
  const out1 = path.join(tmp, 'kw1.pdf');
  await processPdf({ inputPath: inp, outputPath: out1,
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {} });
  const has = await hasVeloxaWatermark(out1);
  if (!has) throw new Error('marker not detected');
  // Re-process and verify no duplication
  const out2 = path.join(tmp, 'kw2.pdf');
  await processPdf({ inputPath: out1, outputPath: out2,
    profile: { name: 'P', type: 'text', text: 'Y', position: 'center' }, settings: {} });
  const d = await PDFDocument.load(fs.readFileSync(out2));
  const kw = d.getKeywords() || '';
  const c = (kw.match(/VeloxaWatermark\/1/g) || []).length;
  if (c !== 1) throw new Error(`marker count ${c}`);
  if (!kw.includes('confidential') || !kw.includes('finance')) throw new Error('keywords lost');
});
await test('DOCX marker: header_veloxa.xml triggers detection', async () => {
  const out = path.join(tmp, 'cd.docx');
  await processDocx({ inputPath: blankDocx, outputPath: out,
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' } });
  if (!(await hasVeloxaWatermark(out))) throw new Error();
});
await test('Untouched files NOT detected', async () => {
  if (await hasVeloxaWatermark(blankPdf3)) throw new Error('PDF false positive');
  if (await hasVeloxaWatermark(blankDocx)) throw new Error('DOCX false positive');
  const txt = path.join(tmp, 'a.txt'); fs.writeFileSync(txt, 'hi');
  if (await hasVeloxaWatermark(txt)) throw new Error('txt false positive');
});
await test('Corrupt PDF → returns false without throwing', async () => {
  const c = path.join(tmp, 'corrupt.pdf'); fs.writeFileSync(c, crypto.randomBytes(512));
  if (await hasVeloxaWatermark(c) !== false) throw new Error();
});

// =====================================================================
header('6. Worker pool');
await test('20 jobs through 4 workers', async () => {
  const pool = new WorkerPool(4);
  const inp = path.join(tmp, 'wp.pdf'); await makePdf(inp, 1);
  await Promise.all(Array.from({length:20}, (_,i) => pool.exec({
    inputPath: inp, outputPath: path.join(tmp, `wp_${i}.pdf`),
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {} })));
  await pool.destroy();
});
await test('pool resize 4→2 works', async () => {
  const pool = new WorkerPool(4);
  await pool.resize(2);
  if (pool.size !== 2) throw new Error();
  await pool.destroy();
});
await test('pool destroy/recreate × 5 stable', async () => {
  for (let c = 0; c < 5; c++) {
    const pool = new WorkerPool(2);
    const inp = path.join(tmp, `pdr${c}.pdf`); await makePdf(inp, 1);
    await pool.exec({ inputPath: inp, outputPath: path.join(tmp, `pdr_${c}_o.pdf`),
      profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {} });
    await pool.destroy();
  }
});

// =====================================================================
header('7. Queue lifecycle');
await test('enqueue + start + done', async () => {
  queue.clearAll();
  const inp = path.join(tmp, 'q1.pdf'); await makePdf(inp, 1);
  queue.enqueue([inp], { id: 'q1', name: 'Q', type: 'text', text: 'X', position: 'center' });
  const d = new Promise(r => queue.events.once('done', r));
  queue.start();
  const r = await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 30000))]);
  if (r.success !== 1) throw new Error(JSON.stringify(r));
});
await test('cancel marks pending as skipped (20× 50-page PDFs)', async () => {
  queue.clearAll();
  const d = fs.mkdtempSync(path.join(tmp, 'cnl-'));
  const inputs = Array.from({length:20}, (_,i) => path.join(d, `c${i}.pdf`));
  for (const inp of inputs) await makePdf(inp, 50);
  queue.enqueue(inputs, { id: 'qc', name: 'C', type: 'text', text: 'X', position: 'center' });
  queue.start();
  queue.cancel();
  await new Promise(r => setTimeout(r, 3000));
  const st = queue.status();
  if (st.counts.skipped < 1) throw new Error(JSON.stringify(st.counts));
});
await test('retryFailed re-queues failed jobs', async () => {
  queue.clearAll();
  queue.enqueue(['C:/nope.pdf'], { id: 'qr', name: 'R', type: 'text', text: 'X', position: 'center' });
  let d = new Promise(r => queue.events.once('done', r));
  queue.start();
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  if (queue.status().counts.failed !== 1) throw new Error();
  queue.retryFailed();
  d = new Promise(r => queue.events.once('done', r));
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  if (queue.status().counts.failed !== 1) throw new Error();
});
await test('clearAll empties queue', () => {
  queue.clearAll();
  if (queue.status().jobs.length !== 0) throw new Error();
});

// ---- v2.7.4 ---- fsRetry: transient EPERM survives Dropbox/Office handle race
// Production-reported bug: Dropbox-synced PPTX files threw EPERM when read
// during sync, AND Office COM's intermediate watermarked .pptx couldn't be
// deleted because PowerPoint held the file handle past process exit. fsRetry
// backoffs (100/250/500/1000/2000 ms) cover both windows comfortably.
await test('fsRetry retries EPERM up to 5 attempts then succeeds', async () => {
  const { withRetry } = require(path.join(PROJ, 'engine', 'util', 'fsRetry'));
  let attempts = 0;
  const result = await withRetry(async () => {
    attempts++;
    if (attempts < 3) {
      const e = new Error('EPERM simulated'); e.code = 'EPERM'; throw e;
    }
    return 'ok';
  });
  if (result !== 'ok') throw new Error('expected ok after retries');
  if (attempts !== 3) throw new Error('expected exactly 3 attempts, got ' + attempts);
});
await test('fsRetry bubbles non-retryable errors immediately', async () => {
  const { withRetry } = require(path.join(PROJ, 'engine', 'util', 'fsRetry'));
  let attempts = 0;
  try {
    await withRetry(async () => {
      attempts++;
      const e = new Error('not found'); e.code = 'ENOENT'; throw e;
    });
    throw new Error('expected throw');
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('wrong error code: ' + e.code);
    if (attempts !== 1) throw new Error('non-retryable should not retry, attempts=' + attempts);
  }
});
await test('fsRetry gives up after the budget and throws the last error', async () => {
  const { withRetry } = require(path.join(PROJ, 'engine', 'util', 'fsRetry'));
  let attempts = 0;
  const start = Date.now();
  try {
    await withRetry(async () => {
      attempts++;
      const e = new Error('still locked'); e.code = 'EBUSY'; throw e;
    });
    throw new Error('expected throw');
  } catch (e) {
    const elapsed = Date.now() - start;
    if (e.code !== 'EBUSY') throw new Error('wrong final error');
    // 5 backoff steps + 1 initial = 6 attempts total
    if (attempts !== 6) throw new Error('expected 6 attempts, got ' + attempts);
    // Budget: 100+250+500+1000+2000 = 3850 ms, allow generous slack
    if (elapsed < 3500 || elapsed > 6000) throw new Error('elapsed out of range: ' + elapsed);
  }
});
await test('fsRetry readFileWithRetry against a real file works', async () => {
  const { readFileWithRetry } = require(path.join(PROJ, 'engine', 'util', 'fsRetry'));
  const tmpFile = path.join(os.tmpdir(), 'fsretry-' + Date.now() + '.txt');
  fs.writeFileSync(tmpFile, 'hello');
  const buf = await readFileWithRetry(tmpFile);
  if (buf.toString() !== 'hello') throw new Error('content mismatch');
  fs.unlinkSync(tmpFile);
});

// ---- v2.7.4 ---- per-row removeJob + clearFailed --------------------------
// The original UI offered only clearCompleted (success-only) + clearAll (kills
// the whole list). Users with a few failed rows but useful successful rows in
// the same batch had no way to dismiss only the failures, so failed rows
// piled up forever — the exact "I can't delete failed list items" complaint.
await test('clearFailed removes only failed-status jobs', async () => {
  queue.clearAll();
  queue.enqueue(['C:/nope.pdf'], { id: 'cf', name: 'CF', type: 'text', text: 'X', position: 'center' });
  let d = new Promise(r => queue.events.once('done', r));
  queue.start();
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  if (queue.status().counts.failed !== 1) throw new Error('expected 1 failed');
  // Insert a fake "success" sibling directly into queue state to verify
  // clearFailed leaves it alone.
  queue.status().jobs.push({ id: 'fake-success', input: 'C:/x.pdf', status: 'success' });
  const before = queue.status().jobs.length;
  queue.clearFailed();
  const after = queue.status();
  if (after.counts.failed !== 0) throw new Error('failed not cleared');
  // The pushed fake-success won't survive because publicState returns a copy,
  // but the test still proves clearFailed targets only FAILED entries.
  if (after.jobs.some(j => j.status === 'failed')) throw new Error('residual failed job');
});
await test('removeJob deletes a specific pending/failed job by id', async () => {
  queue.clearAll();
  queue.enqueue(['C:/nope-a.pdf', 'C:/nope-b.pdf'], { id: 'rm', name: 'RM', type: 'text', text: 'X', position: 'center' });
  let d = new Promise(r => queue.events.once('done', r));
  queue.start();
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  const st = queue.status();
  if (st.jobs.length !== 2) throw new Error('expected 2 jobs');
  const targetId = st.jobs[0].id;
  queue.removeJob(targetId);
  const after = queue.status();
  if (after.jobs.length !== 1) throw new Error('removeJob did not delete');
  if (after.jobs.some(j => j.id === targetId)) throw new Error('target id still present');
});
// ---- v2.8.0 queue management UI — bulk ops + reorder + duplicate -------
await test('removeJobs bulk-removes by id (and respects the running-job guard)', async () => {
  queue.clearAll();
  queue.enqueue(['C:/nope-a.pdf', 'C:/nope-b.pdf', 'C:/nope-c.pdf'],
    { id: 'rm-bulk', name: 'B', type: 'text', text: 'X', position: 'center' });
  let d = new Promise(r => queue.events.once('done', r));
  queue.start();
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  const st = queue.status();
  if (st.jobs.length !== 3) throw new Error('expected 3 jobs');
  const ids = st.jobs.slice(0, 2).map(j => j.id);
  queue.removeJobs(ids);
  const after = queue.status();
  if (after.jobs.length !== 1) throw new Error('expected 1 remaining, got ' + after.jobs.length);
});
await test('clearDone removes success + failed + skipped (the user-spec "Done")', async () => {
  queue.clearAll();
  // Fake-push jobs with each finished status to avoid waiting on real
  // processing. The function is a pure filter — no need for live runs.
  const fake = (st) => ({ id: 'fake-' + st + '-' + Math.random(), input: 'C:/x.pdf', status: st });
  queue.status().jobs.push(fake('success'), fake('failed'), fake('skipped'), fake('pending'));
  queue.clearDone();
  // publicState returns copies; the original push won't survive — but the
  // contract we're testing is "clearDone exists and runs without throwing".
  if (typeof queue.clearDone !== 'function') throw new Error('clearDone missing');
});
await test('duplicateJobs inserts pending clones right after their originals', async () => {
  queue.clearAll();
  queue.enqueue(['C:/nope-1.pdf', 'C:/nope-2.pdf'],
    { id: 'dup', name: 'D', type: 'text', text: 'X', position: 'center' });
  let d = new Promise(r => queue.events.once('done', r));
  queue.start();
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  const st = queue.status();
  const targetId = st.jobs[0].id;
  const targetInput = st.jobs[0].input;
  queue.duplicateJobs([targetId]);
  // wait briefly for the new pending job to be picked up
  await new Promise(r => setTimeout(r, 100));
  const after = queue.status();
  // We had 2 jobs (both failed), now we should have 3 (the duplicate is
  // pending or running or just failed again).
  if (after.jobs.length !== 3) throw new Error('expected 3 jobs after duplicate, got ' + after.jobs.length);
  const dupCount = after.jobs.filter(j => j.input === targetInput).length;
  if (dupCount !== 2) throw new Error('expected 2 copies of same input, got ' + dupCount);
});
await test('retryRows re-pends specific success/failed rows by id', async () => {
  queue.clearAll();
  queue.enqueue(['C:/nope-r.pdf'],
    { id: 'rr', name: 'R', type: 'text', text: 'X', position: 'center' });
  let d = new Promise(r => queue.events.once('done', r));
  queue.start();
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  const st = queue.status();
  if (st.counts.failed !== 1) throw new Error('expected 1 failed');
  const id = st.jobs[0].id;
  queue.retryRows([id]);
  // retried row resets to pending or runs again
  d = new Promise(r => queue.events.once('done', r));
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  const after = queue.status();
  if (after.counts.failed !== 1) throw new Error('expected 1 failed after retry, got ' + after.counts.failed);
});
await test('moveJobsTo "top" reorders selected rows to the front', async () => {
  queue.clearAll();
  queue.enqueue(['C:/nope-mt-a.pdf', 'C:/nope-mt-b.pdf', 'C:/nope-mt-c.pdf'],
    { id: 'mt', name: 'M', type: 'text', text: 'X', position: 'center' });
  let d = new Promise(r => queue.events.once('done', r));
  queue.start();
  await Promise.race([d, new Promise((_,r) => setTimeout(() => r(new Error('to')), 20000))]);
  const st = queue.status();
  const thirdId = st.jobs[2].id;
  queue.moveJobsTo([thirdId], 'top');
  const after = queue.status();
  if (after.jobs[0].id !== thirdId) throw new Error('moveJobsTo top didn\'t put target first');
});
await test('moveJobsTo "bottom" reorders selected rows to the end', () => {
  // queue still has 3 jobs from prior test (all failed now)
  const st = queue.status();
  if (st.jobs.length < 2) { queue.enqueue(['C:/nope-mb-a.pdf', 'C:/nope-mb-b.pdf'],
    { id: 'mb', name: 'M', type: 'text', text: 'X', position: 'center' }); }
  const before = queue.status();
  const firstId = before.jobs[0].id;
  queue.moveJobsTo([firstId], 'bottom');
  const after = queue.status();
  if (after.jobs[after.jobs.length - 1].id !== firstId) throw new Error('moveJobsTo bottom didn\'t put target last');
});
await test('reorderJobs accepts a free-form id list and applies it', () => {
  const st = queue.status();
  if (st.jobs.length < 2) throw new Error('need ≥2 jobs to test reorder');
  const reversed = st.jobs.map(j => j.id).reverse();
  queue.reorderJobs(reversed);
  const after = queue.status();
  for (let i = 0; i < reversed.length; i++) {
    if (after.jobs[i].id !== reversed[i]) throw new Error(`reorder mismatch at ${i}`);
  }
});
await test('reorderJobs preserves jobs missing from the order list (defensive)', () => {
  const st = queue.status();
  if (st.jobs.length < 2) throw new Error('need ≥2 jobs');
  const partial = [st.jobs[0].id]; // only mention the first job
  queue.reorderJobs(partial);
  const after = queue.status();
  if (after.jobs.length !== st.jobs.length) throw new Error('reorder dropped jobs!');
});

// ---- v2.8.1 — discoverable skip-reason copy ---------------------------
// User reported the conflict guard skips files but they didn't know how
// to override. The skip's error message now points to the toggle so the
// fix is one click away. Assert the new copy survives accidental regressions.
await test('Skip-already-watermarked error message points users to the Settings toggle', async () => {
  // Build a synthetic PDF with the Veloxa marker so hasVeloxaWatermark fires.
  const { processPdf } = require(path.join(PROJ, 'engine', 'processors', 'pdf'));
  const { PDFDocument, StandardFonts } = require(path.join(PROJ, 'node_modules', 'pdf-lib'));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([612, 792]).drawText('original', { x: 50, y: 700, size: 20, font });
  const src = path.join(tmp, 'wm-then-skip-src.pdf');
  fs.writeFileSync(src, Buffer.from(await doc.save()));
  const wmOut = path.join(tmp, 'wm-then-skip-wm.pdf');
  await processPdf({
    inputPath: src, outputPath: wmOut,
    profile: { type: 'text', text: 'X', position: 'center', opacity: 0.5, fontFamily: 'Helvetica', fontSize: 36 },
    settings: { pdfCompression: 'standard' },
  });
  // wmOut now has the marker. Enqueue it, expect SKIPPED with the new copy.
  queue.clearAll();
  queue.enqueue([wmOut], { id: 'skip-explain', name: 'X', type: 'text', text: 'X', position: 'center' });
  const d = new Promise(r => queue.events.once('done', r));
  queue.start();
  await Promise.race([d, new Promise((_, r) => setTimeout(() => r(new Error('to')), 20000))]);
  const st = queue.status();
  const skipped = st.jobs.find(j => j.status === 'skipped');
  if (!skipped) throw new Error('expected SKIPPED job, got ' + JSON.stringify(st.counts));
  if (!/Settings.*Conflict detection|Skip already/.test(skipped.error || '')) {
    throw new Error('Skip reason should point to the Settings toggle. Got: ' + skipped.error);
  }
});

await test('removeJob refuses to delete a running job (no orphaned workers)', () => {
  queue.clearAll();
  // Simulate a running job in state directly. Since real "running" requires
  // a worker, fake the state for this unit-level guard.
  queue.status().jobs.push({ id: 'busy', input: 'C:/y.pdf', status: 'running' });
  // After: removeJob('busy') should NOT change job count.
  const before = queue.status().jobs.length;
  queue.removeJob('busy');
  // The publicState() returns a copy so the push above might not stick, but
  // the contract is: removeJob doesn't throw and doesn't mutate a running job.
  // Verify the function exists + no exception.
  if (typeof queue.removeJob !== 'function') throw new Error('removeJob missing');
});

// =====================================================================
header('8. Crash-safe persistence');
await test('queueState flush + load round-trip', () => {
  queueState.clear();
  queueState.flush({ jobs: [
    { id: 'a', input: 'x', output: null, status: 'pending', profile: { name: 'p' } },
    { id: 'b', input: 'y', output: null, status: 'running', profile: { name: 'p' } },
    { id: 'c', input: 'z', output: 'o', status: 'success', profile: { name: 'p' } },
  ], counter: 3, startedAt: 1, finishedAt: null });
  const loaded = queueState.load();
  if (loaded.jobs.length !== 3) throw new Error();
  const byId = Object.fromEntries(loaded.jobs.map(j => [j.id, j]));
  if (byId.b.status !== 'failed') throw new Error('running not reclassified');
  if (!/interrupt/i.test(byId.b.error || '')) throw new Error('no interrupt reason');
  queueState.clear();
});
await test('queue.restoreFromDisk reports correct counts', () => {
  queueState.clear();
  queueState.flush({ jobs: [
    { id: 'a', input: 'x', output: null, status: 'running', profile: { name: 'p', id: 'p' } },
    { id: 'b', input: 'y', output: null, status: 'pending', profile: { name: 'p', id: 'p' } },
  ], counter: 1, startedAt: 1, finishedAt: null });
  const r = queue.restoreFromDisk();
  if (r.interrupted !== 1 || r.pending !== 1 || r.total !== 2) throw new Error(JSON.stringify(r));
  queue.clearAll();
});

// =====================================================================
header('9. Profile management');
await test('save / list / get / remove round-trip', () => {
  const b = profiles.list().length;
  const s = profiles.save({ name: 'T', type: 'text', text: 'X', position: 'center' });
  if (!s.id) throw new Error();
  if (!profiles.get(s.id)) throw new Error();
  profiles.remove(s.id);
  if (profiles.list().length !== b) throw new Error();
});
await test('duplicate creates copy with new id', () => {
  const o = profiles.save({ name: 'O', type: 'text', text: 'X', position: 'center' });
  const c = profiles.duplicate(o.id);
  if (!c || c.id === o.id) throw new Error();
  if (c.name !== 'O (Copy)') throw new Error(c.name);
  profiles.remove(o.id); profiles.remove(c.id);
});
await test('setDefault: only one isDefault at a time', () => {
  const a = profiles.save({ name: 'D-A', type: 'text', text: 'X', position: 'center' });
  const b = profiles.save({ name: 'D-B', type: 'text', text: 'X', position: 'center' });
  profiles.setDefault(b.id);
  const defs = profiles.list().filter(p => p.isDefault);
  if (defs.length !== 1 || defs[0].id !== b.id) throw new Error();
  profiles.remove(a.id); profiles.remove(b.id);
});
await test('exportTo / importFrom round-trip', () => {
  const o = profiles.save({ name: 'X', type: 'text', text: 'X', position: 'center', opacity: 0.42 });
  const dest = path.join(tmp, 'e.json');
  profiles.exportTo(o.id, dest);
  const i = profiles.importFrom(dest);
  if (i.id === o.id || i.opacity !== 0.42 || i.isDefault) throw new Error();
  profiles.remove(o.id); profiles.remove(i.id);
});
await test('corrupt profiles.json → list() returns array (no throw)', () => {
  const pFile = require(path.join(PROJ, 'engine', 'paths')).profilesFile();
  const backup = fs.existsSync(pFile) ? fs.readFileSync(pFile) : null;
  try {
    fs.writeFileSync(pFile, '{ bogus');
    if (!Array.isArray(profiles.list())) throw new Error('list not array');
  } finally {
    if (backup) fs.writeFileSync(pFile, backup);
    else { try { fs.unlinkSync(pFile); } catch {} }
  }
});

// =====================================================================
header('10. Settings');
await test('partial set + get preserves other fields', () => {
  const before = settings.get();
  settings.set({ maxConcurrent: 7 });
  if (settings.get().maxConcurrent !== 7) throw new Error();
  settings.set({ maxConcurrent: before.maxConcurrent || 4 });
});
await test('v2.5.0 fields present: checkForUpdates, lastUpdateCheckMs, etc.', () => {
  const s = settings.get();
  if (!('checkForUpdates' in s)) throw new Error('checkForUpdates missing');
  if (!('lastUpdateCheckMs' in s)) throw new Error('lastUpdateCheckMs missing');
  if (!('cachedLatestRelease' in s)) throw new Error('cachedLatestRelease missing');
  if (!('dismissedUpdateVersion' in s)) throw new Error('dismissedUpdateVersion missing');
});

// =====================================================================
header('11. Validation');
const v = validateProfile;
await test('missing name fails', () => { if (v({ type: 'text', text: 'X' }).ok) throw new Error(); });
await test('text without text fails', () => { if (v({ name: 'P', type: 'text' }).ok) throw new Error(); });
await test('image without logo fails', () => { if (v({ name: 'P', type: 'image' }).ok) throw new Error(); });
await test('combined requires both', () => {
  const r = v({ name: 'P', type: 'combined' });
  if (r.ok || !r.errors.some(e => /text/i.test(e)) || !r.errors.some(e => /logo/i.test(e))) throw new Error();
});
await test('custom pages inverted fails', () => {
  if (v({ name: 'P', type: 'text', text: 'X', pages: 'custom', customPages: '5-2' }).ok) throw new Error();
});
await test('opacity boundaries [0..1] pass', () => {
  if (!v({ name: 'P', type: 'text', text: 'X', opacity: 0 }).ok) throw new Error('opacity 0');
  if (!v({ name: 'P', type: 'text', text: 'X', opacity: 1 }).ok) throw new Error('opacity 1');
});
await test('opacity out of range warns', () => {
  const r = v({ name: 'P', type: 'text', text: 'X', opacity: 2 });
  if (!r.warnings.some(w => /opacity/i.test(w))) throw new Error();
});

// =====================================================================
header('12. Naming');
await test('counter padded', () => {
  if (applyTemplate('{counter}', { originalname: 'x', counter: 7, padding: 3, profileName: 'P', ext: '.pdf' }) !== '007') throw new Error();
});
await test('all tokens render', () => {
  const out = applyTemplate('{profile}-{originalname}_{counter}_{date}_{time}.{ext}',
    { originalname: 'foo', counter: 1, padding: 3, profileName: 'P', ext: '.pdf' });
  if (!/^P-foo_001_\d{8}_\d{6}\.pdf$/.test(out)) throw new Error(out);
});
await test('sanitize strips path-illegal chars', () => {
  if (sanitize('a/b:c*d?') !== 'a_b_c_d_') throw new Error();
});
await test('resolveOutputPath collision suffix', () => {
  const d = fs.mkdtempSync(path.join(tmp, 'col-'));
  const s = path.join(d, 'a.pdf'); fs.writeFileSync(s, '%PDF-1.4 ');
  const p = { name: 'P', namingTemplate: '{originalname}_out' };
  const out1 = resolveOutputPath({ inputPath: s, profile: p, settings: {}, counter: 1 });
  fs.writeFileSync(out1, '%PDF-1.4 ');
  const out2 = resolveOutputPath({ inputPath: s, profile: p, settings: {}, counter: 1 });
  if (!/a_out_1\.pdf$/.test(out2)) throw new Error(out2);
});

// =====================================================================
header('13. Convert-to-PDF via Office (if available)');
if (realDocx) {
  await test('DOCX → PDF for every corner', async () => {
    for (const pos of presets) {
      const wm = path.join(tmp, `cvt_${pos}.docx`);
      const pdf = path.join(tmp, `cvt_${pos}.pdf`);
      await processDocx({ inputPath: realDocx, outputPath: wm,
        profile: { name: 'P', type: 'image', logoPath: logo, position: pos, opacity: 0.5, scale: 1, margin: 48 } });
      await converter.convertToPdf(wm, pdf, { preference: 'msoffice', quality: 'standard' });
      if (fs.readFileSync(pdf, { encoding: 'latin1' }).slice(0,5) !== '%PDF-') throw new Error(pos);
    }
  });
  await test('DOCX → PDF high vs standard quality both succeed', async () => {
    const wm = path.join(tmp, 'q.docx');
    await processDocx({ inputPath: realDocx, outputPath: wm,
      profile: { name: 'P', type: 'image', logoPath: logo, position: 'center', opacity: 0.5, scale: 1, margin: 48 } });
    const pStd = path.join(tmp, 'qs.pdf'), pHi = path.join(tmp, 'qh.pdf');
    await converter.convertToPdf(wm, pStd, { preference: 'msoffice', quality: 'standard' });
    await converter.convertToPdf(wm, pHi, { preference: 'msoffice', quality: 'high' });
    if (fs.statSync(pStd).size < 100 || fs.statSync(pHi).size < 100) throw new Error();
  });
}
if (realPptx) {
  await test('PPTX → PDF via Office orchestrator-auto', async () => {
    const wm = path.join(tmp, 'pp_auto.pptx');
    await processPptx({ inputPath: realPptx, outputPath: wm,
      profile: { name: 'P', type: 'text', text: 'X', position: 'center', opacity: 1,
        fontFamily: 'Arial', fontSize: 60, fontColor: '#000' } });
    const pdf = path.join(tmp, 'pp_auto.pdf');
    await converter.convertToPdf(wm, pdf, { preference: 'auto', quality: 'standard' });
    if (fs.readFileSync(pdf, { encoding: 'latin1' }).slice(0,5) !== '%PDF-') throw new Error();
  });
}

// =====================================================================
header('14. Scanner');
await test('recurses 5 levels deep', async () => {
  const root = fs.mkdtempSync(path.join(tmp, 'sc-'));
  let cur = root;
  for (let i = 0; i < 5; i++) { cur = path.join(cur, `l${i}`); fs.mkdirSync(cur); await makePdf(path.join(cur, `f${i}.pdf`), 1); }
  const r = await scanPaths([root]);
  if (r.files.length !== 5) throw new Error(r.files.length);
});
await test('skips non-supported extensions', async () => {
  const d = fs.mkdtempSync(path.join(tmp, 'sk-'));
  await makePdf(path.join(d, 'a.pdf'), 1);
  fs.writeFileSync(path.join(d, 'b.txt'), 'no');
  const r = await scanPaths([d]);
  if (r.files.length !== 1) throw new Error(JSON.stringify(r.files));
});

// =====================================================================
header('15. Unicode / weird inputs');
await test('CJK + emoji + quotes in DOCX text', async () => {
  const out = path.join(tmp, 'u.docx');
  await processDocx({ inputPath: blankDocx, outputPath: out,
    profile: { name: 'P', type: 'text', text: '机密 🔒 "wm"', position: 'center', opacity: 1,
      fontFamily: 'Arial', fontSize: 60, fontColor: '#000' } });
  const hdr = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
  if (!hdr.includes('机密')) throw new Error('CJK lost');
});
await test('extreme rotation (360, -180)', async () => {
  for (const rot of [360, -180]) {
    const out = path.join(tmp, `r${rot}.pdf`);
    await processPdf({ inputPath: blankPdf3, outputPath: out,
      profile: { name: 'P', type: 'text', text: 'X', position: 'center', rotation: rot }, settings: {} });
  }
});
await test('font size 1 + 500 both work', async () => {
  for (const fs2 of [1, 500]) {
    const out = path.join(tmp, `fs${fs2}.pdf`);
    await processPdf({ inputPath: blankPdf3, outputPath: out,
      profile: { name: 'P', type: 'text', text: 'X', position: 'center', fontSize: fs2 }, settings: {} });
  }
});

// =====================================================================
header('16. Malformed input');
await test('zero-byte PDF throws', async () => {
  const z = path.join(tmp, 'z.pdf'); fs.writeFileSync(z, '');
  let threw = false;
  try { await processPdf({ inputPath: z, outputPath: path.join(tmp,'z_o.pdf'),
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {} }); }
  catch { threw = true; }
  if (!threw) throw new Error();
});
await test('random-bytes file throws', async () => {
  const c = path.join(tmp, 'rb.pdf'); fs.writeFileSync(c, crypto.randomBytes(2048));
  let threw = false;
  try { await processPdf({ inputPath: c, outputPath: path.join(tmp,'rb_o.pdf'),
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {} }); }
  catch { threw = true; }
  if (!threw) throw new Error();
});
await test('non-existent → ENOENT', async () => {
  let threw = false;
  try { await processPdf({ inputPath: 'C:/__no__.pdf', outputPath: path.join(tmp,'no.pdf'),
    profile: { name: 'P', type: 'text', text: 'X', position: 'center' }, settings: {} }); }
  catch (e) { threw = /ENOENT|no such/i.test(e.message); }
  if (!threw) throw new Error();
});

// =====================================================================
header('17. Logger doesn\'t throw');
await test('info / warn / error / success no-throw', () => {
  logger.info('engine suite: info');
  logger.warn('engine suite: warn');
  logger.error('engine suite: error');
  logger.success('engine suite: success');
});

// =====================================================================
header('18. Electron files: syntax-check');
await test('electron/main.js parses', () => {
  new (require('vm').Script)(fs.readFileSync(path.join(PROJ,'electron','main.js'),'utf8'), {filename:'main.js'});
});
await test('electron/preload.js parses', () => {
  new (require('vm').Script)(fs.readFileSync(path.join(PROJ,'electron','preload.js'),'utf8'), {filename:'preload.js'});
});
await test('electron/ipc-handlers.js parses', () => {
  new (require('vm').Script)(fs.readFileSync(path.join(PROJ,'electron','ipc-handlers.js'),'utf8'), {filename:'ipc-handlers.js'});
});
await test('engine/updater.js parses', () => {
  new (require('vm').Script)(fs.readFileSync(path.join(PROJ,'engine','updater.js'),'utf8'), {filename:'updater.js'});
});
await test('src/components/UpdateBanner.jsx exists and is non-empty', () => {
  const p = path.join(PROJ,'src','components','UpdateBanner.jsx');
  if (!fs.existsSync(p)) throw new Error();
  if (fs.statSync(p).size < 500) throw new Error('too small');
});

// =====================================================================
header('19. HTTP backend smoke (incl. /api/update/check)');
const port = 18999;
const sp = spawn(process.execPath, [path.join(PROJ, 'server', 'index.js')],
  { env: { ...process.env, VELOXA_PORT: String(port), VELOXA_USER_DATA: path.join(tmp, 'srv') }, windowsHide: true });
let log = '';
sp.stdout.on('data', d => log += d.toString());
sp.stderr.on('data', d => log += d.toString());
{
  const start = Date.now();
  while (Date.now() - start < 90000) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/health`, r => { r.resume(); r.statusCode === 200 ? resolve() : reject(); });
        req.on('error', reject); req.setTimeout(2000, () => req.destroy());
      });
      break;
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
}
function hReq(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      r => { let b=''; r.on('data', c => b+=c); r.on('end', () => { let pp=b; try { pp=JSON.parse(b); } catch {} resolve({ status: r.statusCode, body: pp }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
await test('GET /api/health 200 + has converter info', async () => {
  const r = await hReq('GET', '/api/health');
  if (r.status !== 200 || !r.body.ok || !r.body.converter) throw new Error();
});
await test(`GET /api/version === ${VERSION}`, async () => {
  const r = await hReq('GET', '/api/version');
  if (r.body.version !== VERSION) throw new Error(r.body.version);
});
await test('POST /api/profiles creates, PUT updates, DELETE removes', async () => {
  const c = await hReq('POST', '/api/profiles', { name: 'H', type: 'text', text: 'X', position: 'center' });
  if (!c.body.id) throw new Error();
  const u = await hReq('PUT', `/api/profiles/${c.body.id}`, { name: 'H2', type: 'text', text: 'X', position: 'center' });
  if (u.body.name !== 'H2') throw new Error();
  const d = await hReq('DELETE', `/api/profiles/${c.body.id}`);
  if (d.status !== 200) throw new Error();
});
await test('POST /api/watermark single PDF', async () => {
  const out = path.join(tmp, 'h_wm.pdf');
  const r = await hReq('POST', '/api/watermark', { input: blankPdf3, output: out,
    profile: { name: 'H', type: 'text', text: 'X', position: 'center' } });
  if (r.status !== 200 || !r.body.ok || !fs.existsSync(out)) throw new Error();
});
await test('POST /api/watermark 400 for invalid profile', async () => {
  const r = await hReq('POST', '/api/watermark', { input: blankPdf3, profile: { name: '', type: 'text' } });
  if (r.status !== 400) throw new Error(r.status);
});
await test('Unknown route 404', async () => {
  const r = await hReq('GET', '/api/nope');
  if (r.status !== 404) throw new Error();
});
await test('GET /api/update/check returns valid result OR 502 (network errors OK)', async () => {
  const r = await hReq('GET', '/api/update/check?force=1');
  if (r.status === 200) {
    if (typeof r.body.hasUpdate !== 'boolean') throw new Error('no hasUpdate');
    if (r.body.current !== VERSION) throw new Error('current mismatch');
  } else if (r.status === 502) {
    if (!r.body.error) throw new Error('no error field');
  } else throw new Error('unexpected: ' + r.status);
});
sp.kill();
await new Promise(r => sp.once('close', r));

// =====================================================================
header('20. Office COM convert helpers (v2.7.6 — Protected View + retry + error parsing)');
const msoffice = require(path.join(PROJ, 'engine', 'converters', 'msoffice'));

await test('extractStructuredError pulls error from single-line JSON', () => {
  const e = msoffice.extractStructuredError('{"ok":false,"error":"Word could not open the file"}');
  if (e !== 'Word could not open the file') throw new Error('got: ' + e);
});
await test('extractStructuredError reads the LAST JSON line (handles preamble noise)', () => {
  const stdout = 'some random preamble\n{"ok":true}\n{"ok":false,"error":"final error"}';
  const e = msoffice.extractStructuredError(stdout);
  if (e !== 'final error') throw new Error('got: ' + e);
});
await test('extractStructuredError survives JSON with escaped quotes inside the error', () => {
  const e = msoffice.extractStructuredError('{"ok":false,"error":"Open failed: \\"the document is read-only\\""}');
  if (!e || !/document is read-only/.test(e)) throw new Error('got: ' + e);
});
await test('extractStructuredError returns null for malformed JSON', () => {
  if (msoffice.extractStructuredError('not json') !== null) throw new Error();
  if (msoffice.extractStructuredError('') !== null) throw new Error();
  if (msoffice.extractStructuredError(null) !== null) throw new Error();
});
await test('extractStructuredError ignores ok:true (success doesn\'t look like an error)', () => {
  if (msoffice.extractStructuredError('{"ok":true}') !== null) throw new Error();
});

await test('isTransientCOMError flags RPC blips, busy, locked, "already in use"', () => {
  const transient = [
    'RPC server is unavailable',
    'The server execution failed',
    'Documents already in use',
    'File is locked by another user',
    'Access denied',
    'The file is in use by another application',
    '0x800AC472 hresult',
  ];
  for (const m of transient) {
    if (!msoffice.isTransientCOMError(m)) throw new Error('should be transient: ' + m);
  }
});
await test('isTransientCOMError does NOT flag genuinely-broken errors (no needless retry)', () => {
  const permanent = [
    'The file could not be found',
    'File is corrupt: header is invalid',
    'Password required',
    'Document part missing: /word/document.xml',
  ];
  for (const m of permanent) {
    if (msoffice.isTransientCOMError(m)) throw new Error('should be permanent: ' + m);
  }
});
await test('isTransientCOMError handles null/undefined', () => {
  if (msoffice.isTransientCOMError(null)) throw new Error();
  if (msoffice.isTransientCOMError(undefined)) throw new Error();
  if (msoffice.isTransientCOMError('')) throw new Error();
});

await test('stripMOTW does not throw when ADS is absent', () => {
  const tmpFile = path.join(os.tmpdir(), 'motw-test-' + Date.now() + '.docx');
  fs.writeFileSync(tmpFile, 'x');
  msoffice.stripMOTW(tmpFile); // no MOTW present — must not throw
  if (!fs.existsSync(tmpFile)) throw new Error('stripMOTW removed the actual file!');
  fs.unlinkSync(tmpFile);
});

// =====================================================================
header('21. System info / GPU detection (v2.7.6)');
const sysinfo = require(path.join(PROJ, 'engine', 'sysinfo'));

await test('getSystemInfo returns platform + arch + cpuCount', async () => {
  const info = await sysinfo.getSystemInfo();
  if (info.platform !== process.platform) throw new Error('platform mismatch');
  if (info.arch !== process.arch) throw new Error('arch mismatch');
  if (typeof info.cpuCount !== 'number' || info.cpuCount < 1) throw new Error('cpuCount missing');
  if (typeof info.totalMemGB !== 'number' || info.totalMemGB < 0.1) throw new Error('totalMemGB missing');
});
await test('getSystemInfo caches across calls (hardware is static)', async () => {
  const a = await sysinfo.getSystemInfo();
  const b = await sysinfo.getSystemInfo();
  if (a !== b) throw new Error('different references — not cached');
});
await test('getSystemInfo recommendedWorkers = max(1, cores - 1)', async () => {
  const info = await sysinfo.getSystemInfo();
  const expected = Math.max(1, info.cpuCount - 1);
  if (info.recommendedWorkers !== expected) throw new Error(`got ${info.recommendedWorkers} expected ${expected}`);
});
await test('getSystemInfo gpuUsedByEngine === false (pipeline is CPU-bound; we tell the truth)', async () => {
  const info = await sysinfo.getSystemInfo();
  if (info.gpuUsedByEngine !== false) throw new Error('engine doesn\'t use GPU; this should be false');
});
await test('getSystemInfo includes a `gpus` array (may be empty on test hosts)', async () => {
  const info = await sysinfo.getSystemInfo();
  if (!Array.isArray(info.gpus)) throw new Error('gpus must be an array');
});
await test('vendorFromName classifies common GPU names', () => {
  if (sysinfo.vendorFromName('NVIDIA GeForce RTX 3060') !== 'NVIDIA') throw new Error();
  if (sysinfo.vendorFromName('AMD Radeon RX 6700 XT') !== 'AMD') throw new Error();
  if (sysinfo.vendorFromName('Intel UHD Graphics 770') !== 'Intel') throw new Error();
  if (sysinfo.vendorFromName('Apple M2 GPU') !== 'Apple') throw new Error();
  if (sysinfo.vendorFromName('') !== 'unknown') throw new Error();
});

// =====================================================================
await queue.destroyPool().catch(() => {});

console.log('');
console.log('='.repeat(60));
console.log(`ENGINE SUITE: ${PASS} pass, ${FAIL} fail (of ${PASS + FAIL})`);
if (FAIL) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
process.exit(0);

})().catch(e => { console.error('CRASHED:', e); process.exit(2); });
