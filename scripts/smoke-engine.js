/**
 * Standalone engine smoke test — generates one of each supported file type
 * in a temp dir, runs each through its processor, and verifies the output.
 * Run with: node scripts/smoke-engine.js
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const PizZip = require('pizzip');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { processPdf } = require('../engine/processors/pdf');
const { processDocx } = require('../engine/processors/docx');
const { processPptx } = require('../engine/processors/pptx');
const { readImageSize } = require('../engine/processors/ooxml');
const WorkerPool = require('../engine/workerPool');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veloxa-smoke-'));
console.log('temp dir:', tmp);

const profile = {
  type: 'text',
  text: 'CONFIDENTIAL',
  fontFamily: 'Helvetica',
  fontSize: 72,
  fontColor: '#C8102E',
  bold: true, italic: false,
  opacity: 0.18, rotation: -30,
  position: 'center', scale: 1, margin: 36,
  pages: 'all', customPages: '',
};
const settings = { pdfCompression: 'standard' };

(async () => {
  let pass = 0, fail = 0;

  // --- Image dimension reader: hand-crafted PNG (3×7) ---
  try {
    // Minimal valid PNG: signature + IHDR(13B) + IDAT(empty) + IEND.
    // We only need the IHDR width/height bytes — readImageSize parses just those.
    const png = Buffer.from([
      0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A, // signature
      0x00,0x00,0x00,0x0D, 0x49,0x48,0x44,0x52, // IHDR length=13, "IHDR"
      0x00,0x00,0x00,0x03, 0x00,0x00,0x00,0x07, // width=3, height=7
      0x08,0x06,0x00,0x00,0x00,                 // depth, color, etc.
      0x00,0x00,0x00,0x00,                      // CRC (bogus — reader doesn't check)
    ]);
    const dims = readImageSize(png);
    if (!dims || dims.width !== 3 || dims.height !== 7)
      throw new Error(`PNG dims wrong: got ${JSON.stringify(dims)}`);
    console.log('✔ Image-size reader — PNG 3×7 detected correctly');
    pass++;
  } catch (e) { console.error('✘ Image-size reader FAILED:', e.message); fail++; }

  // --- PDF font-family mapping ---
  try {
    const pdfMod = require('../engine/processors/pdf');
    // Trigger via a profile carrying Times — output bytes should embed Times-Roman
    const pdf = await PDFDocument.create();
    pdf.addPage([612, 792]);
    const inputPdf = path.join(tmp, 'in_font.pdf');
    fs.writeFileSync(inputPdf, await pdf.save());
    const outPdf = path.join(tmp, 'out_times.pdf');
    await pdfMod.processPdf({
      inputPath: inputPdf,
      outputPath: outPdf,
      profile: { ...profile, fontFamily: 'Times New Roman', text: 'TIMES' },
      settings: { pdfCompression: 'none' }, // disable object streams so font dict is plaintext
    });
    const outBytes = fs.readFileSync(outPdf);
    const txt = outBytes.toString('latin1');
    // Per PDF Type1 names: Times-Roman, Times-Bold, Times-Italic, Times-BoldItalic
    const hasTimes = /\/Times-(Roman|Bold|Italic|BoldItalic)/.test(txt);
    const hasHelvetica = txt.includes('/Helvetica');
    if (!hasTimes) throw new Error('No Times-* font embedded — fontFamily mapping broken');
    if (hasHelvetica) throw new Error('Helvetica leaked into output — mapping picked wrong family');
    console.log('✔ PDF font mapping — Times family embedded when fontFamily="Times New Roman"');
    pass++;
  } catch (e) { console.error('✘ PDF font mapping FAILED:', e.message); fail++; }

  // --- PDF ---
  try {
    const pdf = await PDFDocument.create();
    const f = await pdf.embedFont(StandardFonts.Helvetica);
    const p = pdf.addPage([612, 792]);
    p.drawText('Hello PDF', { x: 50, y: 720, size: 24, font: f, color: rgb(0, 0, 0) });
    pdf.addPage([612, 792]);
    pdf.addPage([612, 792]);
    const inputPdf = path.join(tmp, 'in.pdf');
    fs.writeFileSync(inputPdf, await pdf.save());

    const outPdf = path.join(tmp, 'out.pdf');
    await processPdf({ inputPath: inputPdf, outputPath: outPdf, profile, settings });
    const verifyPdf = await PDFDocument.load(fs.readFileSync(outPdf));
    if (verifyPdf.getPageCount() !== 3) throw new Error(`page count drift: ${verifyPdf.getPageCount()}`);
    console.log('✔ PDF processor — output', fs.statSync(outPdf).size, 'bytes,', verifyPdf.getPageCount(), 'pages');
    pass++;
  } catch (e) { console.error('✘ PDF processor FAILED:', e.message); fail++; }

  // --- DOCX (position) ---
  try {
    const docx = new PizZip();
    docx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    docx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    docx.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body>
</w:document>`);
    docx.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);

    const inputDocx = path.join(tmp, 'in.docx');
    fs.writeFileSync(inputDocx, docx.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

    const outDocx = path.join(tmp, 'out.docx');
    await processDocx({ inputPath: inputDocx, outputPath: outDocx, profile: { ...profile, position: 'top-right', offsetX: 12, offsetY: -8 } });

    const verifyDocx = new PizZip(fs.readFileSync(outDocx));
    if (!verifyDocx.file('word/header_veloxa.xml')) throw new Error('header part missing');
    if (!verifyDocx.file('word/document.xml').asText().includes('headerReference'))
      throw new Error('headerReference not wired into document.xml');
    const headerXml = verifyDocx.file('word/header_veloxa.xml').asText();
    // v2.4.2: named mso-position-horizontal/vertical anchors were REMOVED
    // because they silently override the margin-left/top offset in Word.
    // Now we emit absolute coords computed from the page edge.
    if (/mso-position-horizontal:(left|right|center)/.test(headerXml))
      throw new Error('DOCX named horizontal anchor present (would override margin-left)');
    if (/mso-position-vertical:(top|bottom|center)/.test(headerXml))
      throw new Error('DOCX named vertical anchor present (would override margin-top)');
    if (!/mso-position-horizontal-relative:page/.test(headerXml))
      throw new Error('DOCX horizontal-relative should be "page"');
    if (!/mso-position-vertical-relative:page/.test(headerXml))
      throw new Error('DOCX vertical-relative should be "page"');
    // top-right + margin=36 (from base profile) + offsetX=12, offsetY=-8,
    // default page 612×792, corner text 240×80:
    //   marginLeft = 612 - 240 - 36 + 12 = 348pt
    //   marginTop  = 36 + (-8)            = 28pt
    if (!/margin-left:348pt/.test(headerXml))
      throw new Error('DOCX top-right + margin=36 + offsetX=12 should produce margin-left:348pt');
    if (!/margin-top:28pt/.test(headerXml))
      throw new Error('DOCX top-right + margin=36 + offsetY=-8 should produce margin-top:28pt');
    console.log('✔ DOCX processor — output', fs.statSync(outDocx).size, 'bytes, top-right+margin36+offset(12,-8) → (348pt,28pt)');
    pass++;
  } catch (e) { console.error('✘ DOCX processor FAILED:', e.message); fail++; }

  // --- DOCX corner positioning uses page-relative (not margin-relative) ---
  try {
    const docx = new PizZip();
    docx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    docx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    docx.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>`);
    docx.file('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
    const inp = path.join(tmp, 'in_corner.docx');
    fs.writeFileSync(inp, docx.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

    // v2.4.2: corners and center BOTH use page-relative with computed absolute
    // coords. Named anchors (mso-position-horizontal:left/right/center) are
    // gone — they overrode margin-left and broke the user's margin + X/Y.
    const out1 = path.join(tmp, 'out_corner.docx');
    await processDocx({ inputPath: inp, outputPath: out1, profile: { ...profile, position: 'top-left', margin: 48 } });
    const head1 = new PizZip(fs.readFileSync(out1)).file('word/header_veloxa.xml').asText();
    if (!/mso-position-horizontal-relative:page/.test(head1))
      throw new Error('top-left: horizontal-relative should be "page"');
    if (!/mso-position-vertical-relative:page/.test(head1))
      throw new Error('top-left: vertical-relative should be "page"');
    if (/mso-position-horizontal:(left|right|center)/.test(head1))
      throw new Error('top-left: named horizontal anchor present (would override margin-left)');
    // top-left + margin=48 → margin-left=48pt, margin-top=48pt
    if (!/margin-left:48pt/.test(head1))
      throw new Error('top-left + margin=48 should produce margin-left:48pt');
    if (!/margin-top:48pt/.test(head1))
      throw new Error('top-left + margin=48 should produce margin-top:48pt');

    // Center — also page-relative, also computed
    const out2 = path.join(tmp, 'out_center.docx');
    await processDocx({ inputPath: inp, outputPath: out2, profile: { ...profile, position: 'center' } });
    const head2 = new PizZip(fs.readFileSync(out2)).file('word/header_veloxa.xml').asText();
    if (!/mso-position-horizontal-relative:page/.test(head2))
      throw new Error('center: horizontal-relative should be "page" in v2.4.2');
    if (!/mso-position-vertical-relative:page/.test(head2))
      throw new Error('center: vertical-relative should be "page" in v2.4.2');
    if (/mso-position-horizontal:(left|right|center)/.test(head2))
      throw new Error('center: named horizontal anchor present (would override margin-left)');

    console.log('✔ DOCX positioning — all presets use computed absolute coords from page edge (margin+offset now actually work)');
    pass++;
  } catch (e) { console.error('✘ DOCX positioning FAILED:', e.message); fail++; }

  // --- DOCX multi-section: headerReference must appear in EVERY sectPr ---
  try {
    const docx = new PizZip();
    docx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    docx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    docx.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Section A</w:t></w:r></w:p>
<w:p><w:pPr><w:sectPr/></w:pPr></w:p>
<w:p><w:r><w:t>Section B</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
</w:body></w:document>`);
    docx.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);

    const inp = path.join(tmp, 'in_multi.docx');
    fs.writeFileSync(inp, docx.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const out = path.join(tmp, 'out_multi.docx');
    await processDocx({ inputPath: inp, outputPath: out, profile });
    const docXmlOut = new PizZip(fs.readFileSync(out)).file('word/document.xml').asText();
    const refCount = (docXmlOut.match(/<w:headerReference[^>]*r:id="rIdVeloxaHeader"/g) || []).length;
    if (refCount !== 2)
      throw new Error(`headerReference not injected into all sectPr — got ${refCount}, expected 2 (one self-closing + one open)`);
    // Self-closing should now be expanded into <w:sectPr>...</w:sectPr>
    if (/<w:sectPr\/>/.test(docXmlOut))
      throw new Error('self-closing <w:sectPr/> still present — should have been expanded');
    console.log('✔ DOCX multi-section — headerRef injected into both sectPr (self-closing + open)');
    pass++;
  } catch (e) { console.error('✘ DOCX multi-section FAILED:', e.message); fail++; }

  // --- Special chars in watermark text are XML-escaped ---
  try {
    const docx = new PizZip();
    docx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
    docx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
    docx.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>`);
    docx.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`);
    const inp = path.join(tmp, 'in_xml.docx');
    fs.writeFileSync(inp, docx.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const out = path.join(tmp, 'out_xml.docx');
    await processDocx({ inputPath: inp, outputPath: out, profile: { ...profile, text: 'A & B <c> "d" \'e\'' } });
    const headerXml = new PizZip(fs.readFileSync(out)).file('word/header_veloxa.xml').asText();
    if (headerXml.includes('A & B <c>'))
      throw new Error('special XML chars not escaped in DOCX header');
    if (!headerXml.includes('A &amp; B &lt;c&gt;'))
      throw new Error(`expected escaped form not found, got: ${headerXml.slice(headerXml.indexOf('string='), headerXml.indexOf('string=') + 100)}`);
    console.log('✔ DOCX XML escaping — special chars correctly escaped in watermark text');
    pass++;
  } catch (e) { console.error('✘ DOCX XML escaping FAILED:', e.message); fail++; }

  // --- PPTX multi-slide + custom page range ---
  try {
    const pptx = new PizZip();
    pptx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide3.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
    pptx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
    pptx.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldSz cx="9144000" cy="6858000"/></p:presentation>`);
    const slideXmlBase = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sld>`;
    pptx.file('ppt/slides/slide1.xml', slideXmlBase);
    pptx.file('ppt/slides/slide2.xml', slideXmlBase);
    pptx.file('ppt/slides/slide3.xml', slideXmlBase);

    const inp = path.join(tmp, 'in_multi.pptx');
    fs.writeFileSync(inp, pptx.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
    const out = path.join(tmp, 'out_multi.pptx');
    await processPptx({ inputPath: inp, outputPath: out, profile: { ...profile, pages: 'custom', customPages: '1,3' } });
    const z = new PizZip(fs.readFileSync(out));
    const has1 = z.file('ppt/slides/slide1.xml').asText().includes('VeloxaWatermarkText');
    const has2 = z.file('ppt/slides/slide2.xml').asText().includes('VeloxaWatermarkText');
    const has3 = z.file('ppt/slides/slide3.xml').asText().includes('VeloxaWatermarkText');
    if (!has1) throw new Error('slide 1 missing watermark (custom range "1,3")');
    if (has2)  throw new Error('slide 2 has watermark but should be skipped');
    if (!has3) throw new Error('slide 3 missing watermark (custom range "1,3")');
    console.log('✔ PPTX multi-slide + custom range "1,3" — slide 2 correctly skipped');
    pass++;
  } catch (e) { console.error('✘ PPTX multi-slide FAILED:', e.message); fail++; }

  // --- PPTX ---
  try {
    const pptx = new PizZip();
    pptx.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
    pptx.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
    pptx.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:sldSz cx="9144000" cy="6858000"/>
<p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`);
    pptx.file('ppt/slides/slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr/>
</p:spTree></p:cSld>
</p:sld>`);

    const inputPptx = path.join(tmp, 'in.pptx');
    fs.writeFileSync(inputPptx, pptx.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));

    // First run: bottom-left baseline
    const outPptx = path.join(tmp, 'out.pptx');
    await processPptx({ inputPath: inputPptx, outputPath: outPptx, profile: { ...profile, position: 'bottom-left' } });
    const verifyPptx = new PizZip(fs.readFileSync(outPptx));
    const slideXml = verifyPptx.file('ppt/slides/slide1.xml').asText();
    if (!slideXml.includes('VeloxaWatermarkText')) throw new Error('watermark shape not injected into slide');
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(slideXml);
    if (!off) throw new Error('shape offset missing');
    const x = parseInt(off[1], 10), y = parseInt(off[2], 10);
    if (x > 1_000_000) throw new Error(`PPTX position not applied (x=${x} too large for bottom-left)`);
    if (y < 3_000_000) throw new Error(`PPTX position not applied (y=${y} too small for bottom-left)`);

    // Second run: same position + 50pt offsetX, -25pt offsetY → x should grow, y should shrink
    const outPptx2 = path.join(tmp, 'out2.pptx');
    await processPptx({ inputPath: inputPptx, outputPath: outPptx2, profile: { ...profile, position: 'bottom-left', offsetX: 50, offsetY: -25 } });
    const slideXml2 = new PizZip(fs.readFileSync(outPptx2)).file('ppt/slides/slide1.xml').asText();
    const off2 = /<a:off x="(-?\d+)" y="(-?\d+)"\/>/.exec(slideXml2);
    const x2 = parseInt(off2[1], 10), y2 = parseInt(off2[2], 10);
    const expectedDx = 50 * 12700, expectedDy = -25 * 12700;
    if (x2 - x !== expectedDx) throw new Error(`PPTX offsetX not applied (delta=${x2 - x}, expected ${expectedDx})`);
    if (y2 - y !== expectedDy) throw new Error(`PPTX offsetY not applied (delta=${y2 - y}, expected ${expectedDy})`);

    console.log('✔ PPTX processor — bottom-left honored (x=' + x + ' y=' + y + '), offsetX=+50pt offsetY=-25pt produced ' + (x2 - x) + '/' + (y2 - y) + ' EMU shift');
    pass++;
  } catch (e) { console.error('✘ PPTX processor FAILED:', e.message); fail++; }

  // --- Worker pool: parallel processing through pool of 3 ---
  let pool = null;
  try {
    pool = new WorkerPool(3);

    // Generate 6 small input PDFs
    const inputs = [];
    for (let i = 0; i < 6; i += 1) {
      const pdf = await PDFDocument.create();
      pdf.addPage([612, 792]);
      const ip = path.join(tmp, `pool_in_${i}.pdf`);
      fs.writeFileSync(ip, await pdf.save());
      inputs.push(ip);
    }

    // Dispatch all 6 in parallel; pool of 3 will queue the latter 3.
    const t0 = Date.now();
    const outputs = await Promise.all(inputs.map((inp, i) =>
      pool.exec({
        inputPath: inp,
        outputPath: path.join(tmp, `pool_out_${i}.pdf`),
        profile,
        settings,
      })
    ));
    const elapsed = Date.now() - t0;

    if (outputs.length !== 6) throw new Error(`expected 6 results, got ${outputs.length}`);
    for (const out of outputs) {
      if (!fs.existsSync(out.outputPath)) throw new Error(`missing output ${out.outputPath}`);
    }
    const stats = pool.stats();
    console.log(`✔ Worker pool — 6 jobs across 3 workers in ${elapsed}ms (size=${stats.size}, total=${stats.total})`);
    pass++;

    // Test resize down
    await pool.resize(2);
    if (pool.stats().size !== 2) throw new Error('resize down to 2 failed');
    console.log('✔ Worker pool — resize down to 2 workers OK');
    pass++;
  } catch (e) {
    console.error('✘ Worker pool FAILED:', e.message);
    fail++;
  } finally {
    if (pool) await pool.destroy();
  }

  console.log(`\n${pass}/${pass+fail} processors passed`);
  if (fail > 0) process.exit(1);
})();
