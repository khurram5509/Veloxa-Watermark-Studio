/**
 * DOCX watermark injection.
 * Strategy: inject a VML-based watermark inside the document's header part
 * (creating a default header if missing). This is the same technique Word
 * itself uses for "Insert > Watermark" and renders in Word/LibreOffice.
 */
const path = require('node:path');
const { readZip, writeZip, escapeXml, readImage } = require('./ooxml');

const HEADER_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/**
 * Default page size (US Letter) used when we can't parse the document's pgSz.
 * Units = points. Letter is 8.5"×11" = 612pt × 792pt; A4 is 595pt × 842pt.
 */
const DEFAULT_PAGE = { widthPt: 612, heightPt: 792 };

/**
 * Parse the document's first <w:pgSz w:w=".." w:h=".."/> in twips and convert
 * to points (1pt = 20 twips). Falls back to US Letter if not found.
 *
 * We need real page dimensions because we position the watermark by absolute
 * margin-left/margin-top from the page edge — VML's named anchors
 * (mso-position-horizontal:left/right/center) silently override our literal
 * margin-left in Word, so the user's X/Y offsets and Margin field had no
 * visible effect. Computing absolute coordinates ourselves restores them.
 */
function readPageSize(zip) {
  const xml = zip.file('word/document.xml')?.asText() || '';
  // pgSz attributes can appear in any order; match each independently.
  const widthMatch = xml.match(/<w:pgSz\b[^>]*\bw:w="(\d+)"/);
  const heightMatch = xml.match(/<w:pgSz\b[^>]*\bw:h="(\d+)"/);
  if (widthMatch && heightMatch) {
    return {
      widthPt: parseInt(widthMatch[1], 10) / 20,
      heightPt: parseInt(heightMatch[1], 10) / 20,
    };
  }
  return DEFAULT_PAGE;
}

/**
 * Compute absolute margin-left / margin-top (pt) from the page edge for a
 * given preset + watermark size, factoring in profile.margin (edge inset)
 * and profile.offsetX/Y (additional nudge).
 *
 * Returns absolute coordinates relative to the page's top-left, suitable for
 * VML's `margin-left:` / `margin-top:` when paired with
 * `mso-position-*-relative:page` and NO `mso-position-horizontal/vertical`
 * directive (the absence of a named anchor makes Word treat margin-left/top
 * as the literal offset from the relative anchor).
 */
function computePosition({ position, pageW, pageH, wmW, wmH, margin, offsetX, offsetY }) {
  const m = Math.max(0, margin || 0);
  const ox = offsetX || 0;
  const oy = offsetY || 0;
  let left;
  let top;
  switch (position) {
    case 'top-left':
      left = m;
      top = m;
      break;
    case 'top-center':
      left = (pageW - wmW) / 2;
      top = m;
      break;
    case 'top-right':
      left = pageW - wmW - m;
      top = m;
      break;
    case 'middle-left':
      left = m;
      top = (pageH - wmH) / 2;
      break;
    case 'middle-right':
      left = pageW - wmW - m;
      top = (pageH - wmH) / 2;
      break;
    case 'bottom-left':
      left = m;
      top = pageH - wmH - m;
      break;
    case 'bottom-center':
      left = (pageW - wmW) / 2;
      top = pageH - wmH - m;
      break;
    case 'bottom-right':
      left = pageW - wmW - m;
      top = pageH - wmH - m;
      break;
    case 'diagonal':
    case 'center':
    default:
      left = (pageW - wmW) / 2;
      top = (pageH - wmH) / 2;
      break;
  }
  // Round to 2 decimals — keeps the XML tidy without losing sub-point precision.
  return {
    marginLeft: Math.round((left + ox) * 100) / 100,
    marginTop: Math.round((top + oy) * 100) / 100,
  };
}

function buildTextWatermarkVml(profile, pageSize) {
  const text = escapeXml(profile.text || '');
  const opacityPct = Math.max(0, Math.min(1, profile.opacity ?? 1));
  const color = profile.fontColor || '#808080';
  const rotation = profile.rotation ?? 0;
  const size = profile.fontSize || 72;
  const bold = profile.bold ? 'bold' : 'normal';
  const italic = profile.italic ? 'italic' : 'normal';
  const fontFamily = profile.fontFamily || 'Arial';
  // "Compact" positions — every cell of the 3×3 grid except the actual center.
  // These get the small watermark size so corner+edge marks don't overflow.
  const isCorner = [
    'top-left', 'top-center', 'top-right',
    'middle-left', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ].includes(profile.position);
  const widthPt = isCorner ? 240 : 468;
  const heightPt = isCorner ? 80 : 200;
  const { marginLeft, marginTop } = computePosition({
    position: profile.position,
    pageW: pageSize.widthPt,
    pageH: pageSize.heightPt,
    wmW: widthPt,
    wmH: heightPt,
    margin: profile.margin,
    offsetX: profile.offsetX,
    offsetY: profile.offsetY,
  });

  return `
    <w:p>
      <w:pPr><w:pStyle w:val="Header"/></w:pPr>
      <w:r>
        <w:rPr><w:noProof/></w:rPr>
        <w:pict>
          <v:shapetype id="vxWmShape" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e">
            <v:formulas>
              <v:f eqn="sum #0 0 10800"/>
              <v:f eqn="prod #0 2 1"/>
              <v:f eqn="sum 21600 0 @1"/>
              <v:f eqn="sum 0 0 @2"/>
              <v:f eqn="sum 21600 0 @3"/>
              <v:f eqn="if @0 @3 0"/>
              <v:f eqn="if @0 21600 @1"/>
              <v:f eqn="if @0 0 @2"/>
              <v:f eqn="if @0 @4 21600"/>
            </v:formulas>
            <v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="custom"/>
            <v:textpath on="t" fitshape="t"/>
          </v:shapetype>
          <v:shape id="vxWatermark" type="#vxWmShape"
                   style="position:absolute;margin-left:${marginLeft}pt;margin-top:${marginTop}pt;width:${widthPt}pt;height:${heightPt}pt;rotation:${rotation};z-index:251658752;mso-position-horizontal-relative:page;mso-position-vertical-relative:page"
                   fillcolor="${color}" stroked="f">
            <v:fill opacity="${opacityPct}"/>
            <v:textpath style="font-family:&quot;${fontFamily}&quot;;font-size:${size}pt;font-style:${italic};font-weight:${bold};v-text-align:center" string="${text}"/>
          </v:shape>
        </w:pict>
      </w:r>
    </w:p>`;
}

function buildImageWatermarkVml(profile, relId, imgWidth, imgHeight, pageSize) {
  const opacityPct = Math.max(0, Math.min(1, profile.opacity ?? 1));
  const rotation = profile.rotation ?? 0;
  const scale = profile.scale || 1;
  // "Compact" positions — every cell of the 3×3 grid except the actual center.
  // These get the small watermark size so corner+edge marks don't overflow.
  const isCorner = [
    'top-left', 'top-center', 'top-right',
    'middle-left', 'middle-right',
    'bottom-left', 'bottom-center', 'bottom-right',
  ].includes(profile.position);
  // Preserve the source image's aspect ratio. If we couldn't read dimensions,
  // fall back to a sane default (~3:2 landscape).
  const aspect = (imgWidth && imgHeight) ? (imgHeight / imgWidth) : (2 / 3);
  const w = (isCorner ? 160 : 300) * scale;
  const h = w * aspect;
  const { marginLeft, marginTop } = computePosition({
    position: profile.position,
    pageW: pageSize.widthPt,
    pageH: pageSize.heightPt,
    wmW: w,
    wmH: h,
    margin: profile.margin,
    offsetX: profile.offsetX,
    offsetY: profile.offsetY,
  });
  return `
    <w:p>
      <w:pPr><w:pStyle w:val="Header"/></w:pPr>
      <w:r>
        <w:rPr><w:noProof/></w:rPr>
        <w:pict>
          <v:shape id="vxWatermarkImg" type="#_x0000_t75"
                   style="position:absolute;margin-left:${marginLeft}pt;margin-top:${marginTop}pt;width:${w}pt;height:${h}pt;rotation:${rotation};z-index:251658751;mso-position-horizontal-relative:page;mso-position-vertical-relative:page">
            <v:imagedata r:id="${relId}" gain="${opacityPct}"/>
          </v:shape>
        </w:pict>
      </w:r>
    </w:p>`;
}

const HEADER_XML = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:o="urn:schemas-microsoft-com:office:office"
       xmlns:v="urn:schemas-microsoft-com:vml"
       xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${body}
</w:hdr>`;

const HEADER_RELS_XML = (relsBody) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${relsBody}
</Relationships>`;

function ensureContentTypes(zip) {
  const ctPath = '[Content_Types].xml';
  let xml = zip.file(ctPath)?.asText() || '';
  if (!xml.includes('Extension="png"')) {
    xml = xml.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  }
  if (!xml.includes('Extension="jpeg"')) {
    xml = xml.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  }
  if (!xml.includes('PartName="/word/header_veloxa.xml"')) {
    xml = xml.replace('</Types>',
      '<Override PartName="/word/header_veloxa.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>');
  }
  zip.file(ctPath, xml);
}

function ensureSectionHeaderRef(zip, headerRelId) {
  const documentPath = 'word/document.xml';
  const docXml = zip.file(documentPath)?.asText();
  if (!docXml) return;
  if (docXml.includes(`r:id="${headerRelId}"`)) return;

  // Word picks one of three header parts per page:
  //   - `first` → page 1 when <w:titlePg/> is set ("Different First Page")
  //   - `even`  → even pages when <w:evenAndOddHeaders/> is set
  //   - `default` → everything else
  //
  // Previously we only injected the `default` headerReference, so a document
  // with a cover page (titlePg) silently lost its watermark on page 1 — the
  // exact bug a user just reported. Now we inject all three pointing at the
  // SAME header part, so whichever variant Word chooses still shows the
  // watermark.
  const headerRefs = [
    `<w:headerReference r:id="${headerRelId}" w:type="default" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`,
    `<w:headerReference r:id="${headerRelId}" w:type="first" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`,
    `<w:headerReference r:id="${headerRelId}" w:type="even" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>`,
  ].join('');

  // Match every <w:sectPr ...> opening tag AND every self-closing <w:sectPr/>.
  // Multi-section docs have multiple sectPr; each needs its own headerRefs
  // or the watermark shows up only in the first section.
  const sectPrRegex = /<w:sectPr(\s[^>]*)?\s*(\/)?>/g;
  let matched = false;
  let updated = docXml.replace(sectPrRegex, (match, attrs, selfClose) => {
    matched = true;
    if (selfClose) {
      // <w:sectPr/> → <w:sectPr>{headerRefs}</w:sectPr>
      return `<w:sectPr${attrs || ''}>${headerRefs}</w:sectPr>`;
    }
    // <w:sectPr ...> → <w:sectPr ...>{headerRefs}
    return `${match}${headerRefs}`;
  });

  // Fallback: minimal docs without any sectPr — synthesize one before </w:body>.
  if (!matched) {
    updated = docXml.replace('</w:body>', `<w:sectPr>${headerRefs}</w:sectPr></w:body>`);
  }
  zip.file(documentPath, updated);
}

function ensureDocumentRels(zip, headerRelId, headerTarget) {
  const relsPath = 'word/_rels/document.xml.rels';
  let xml = zip.file(relsPath)?.asText();
  if (!xml) {
    xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  }
  if (xml.includes(`Id="${headerRelId}"`)) return;
  const rel = `<Relationship Id="${headerRelId}" Type="${HEADER_REL_TYPE}" Target="${headerTarget}"/>`;
  xml = xml.replace('</Relationships>', `${rel}</Relationships>`);
  zip.file(relsPath, xml);
}

async function processDocx({ inputPath, outputPath, profile }) {
  const zip = await readZip(inputPath);
  const pageSize = readPageSize(zip);

  const headerRelId = 'rIdVeloxaHeader';
  const headerTarget = 'header_veloxa.xml';
  const imageRelId = 'rIdVeloxaImg';

  let headerInnerXml = '';
  let headerRelsBody = '';

  if (profile.type === 'image' || profile.type === 'combined') {
    const img = await readImage(profile.logoPath);
    if (img) {
      const imageName = `media/veloxa_logo.${img.ext}`;
      zip.file(`word/${imageName}`, img.data);
      headerRelsBody += `<Relationship Id="${imageRelId}" Type="${IMAGE_REL_TYPE}" Target="${imageName}"/>`;
      headerInnerXml += buildImageWatermarkVml(profile, imageRelId, img.width, img.height, pageSize);
    }
  }

  if (profile.type === 'text' || profile.type === 'combined') {
    headerInnerXml += buildTextWatermarkVml(profile, pageSize);
  }

  if (!headerInnerXml) {
    headerInnerXml = buildTextWatermarkVml({ ...profile, text: profile.text || ' ' }, pageSize);
  }

  zip.file(`word/${headerTarget}`, HEADER_XML(headerInnerXml));
  zip.file('word/_rels/header_veloxa.xml.rels', HEADER_RELS_XML(headerRelsBody));

  ensureDocumentRels(zip, headerRelId, headerTarget);
  ensureSectionHeaderRef(zip, headerRelId);
  ensureContentTypes(zip);

  await writeZip(zip, outputPath);
  return { outputPath };
}

module.exports = { processDocx };
