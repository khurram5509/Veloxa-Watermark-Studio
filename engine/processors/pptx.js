/**
 * PPTX watermark injection — adds a watermark shape (text and/or image) into
 * each slide layout / slide master so the mark appears on every slide that
 * uses the master. We append shapes directly into existing slide XML for
 * maximum compatibility.
 */
const { readZip, writeZip, escapeXml, readImage } = require('./ooxml');

const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

const EMU_PER_INCH = 914400;

function emu(inches) { return Math.round(inches * EMU_PER_INCH); }

function hexToColor(hex) {
  return (hex || '#808080').replace('#', '').toUpperCase();
}

// Convert profile.margin (in points) to EMU (1 pt = 12700 EMU)
const PT_TO_EMU = 12700;

/**
 * Compute the (x, y) offset and the (anchor, algn) text alignment
 * for a watermark shape of size (cx × cy) on a slide of size (slideW × slideH).
 * Honours profile.position (top-left, top-right, bottom-left, bottom-right, center, diagonal) and profile.margin.
 */
function placeShape({ position, marginEmu, offsetXEmu = 0, offsetYEmu = 0 }, slideW, slideH, cx, cy) {
  const cxClamped = Math.min(cx, slideW);
  const cyClamped = Math.min(cy, slideH);
  let base;
  switch (position) {
    case 'top-left':
      base = { x: marginEmu, y: marginEmu, anchor: 't', algn: 'l' }; break;
    case 'top-right':
      base = { x: slideW - cxClamped - marginEmu, y: marginEmu, anchor: 't', algn: 'r' }; break;
    case 'bottom-left':
      base = { x: marginEmu, y: slideH - cyClamped - marginEmu, anchor: 'b', algn: 'l' }; break;
    case 'bottom-right':
      base = { x: slideW - cxClamped - marginEmu, y: slideH - cyClamped - marginEmu, anchor: 'b', algn: 'r' }; break;
    case 'diagonal':
    case 'center':
    default:
      base = {
        x: Math.round((slideW - cxClamped) / 2),
        y: Math.round((slideH - cyClamped) / 2),
        anchor: 'ctr',
        algn: 'ctr',
      };
  }
  return { ...base, x: base.x + offsetXEmu, y: base.y + offsetYEmu };
}

function shapeSize(profile, slideW, slideH, kind, imgWidth, imgHeight) {
  const isCorner = ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(profile.position);
  const scale = profile.scale || 1;
  if (kind === 'text') {
    // Corners get a tighter box; center/diagonal gets a wide box for big text
    const cx = Math.round(slideW * (isCorner ? 0.45 : 0.85) * (isCorner ? 1 : Math.max(1, scale)));
    const cy = Math.round(slideH * (isCorner ? 0.18 : 0.32));
    return { cx, cy };
  }
  // image — preserve source image aspect ratio
  const baseFraction = isCorner ? 0.22 : 0.4;
  const cx = Math.round(slideW * baseFraction * scale);
  const aspect = (imgWidth && imgHeight) ? (imgHeight / imgWidth) : 1;
  const cy = Math.round(cx * aspect);
  return { cx, cy };
}

function buildTextShape(profile, idx, slideW, slideH) {
  const text = escapeXml(profile.text || '');
  const colorHex = hexToColor(profile.fontColor);
  const opacity = Math.round(Math.max(0, Math.min(1, profile.opacity ?? 1)) * 100000);
  const rotation = (profile.rotation ?? 0) * 60000; // PPT uses 1/60000 degrees
  const sizeHundredths = (profile.fontSize || 60) * 100;
  const bold = profile.bold ? 1 : 0;
  const italic = profile.italic ? 1 : 0;

  const { cx, cy } = shapeSize(profile, slideW, slideH, 'text');
  const marginEmu = Math.round((profile.margin ?? 36) * PT_TO_EMU);
  const offsetXEmu = Math.round((profile.offsetX || 0) * PT_TO_EMU);
  const offsetYEmu = Math.round((profile.offsetY || 0) * PT_TO_EMU);
  const { x, y, anchor, algn } = placeShape(
    { position: profile.position, marginEmu, offsetXEmu, offsetYEmu },
    slideW, slideH, cx, cy,
  );

  return `
    <p:sp>
      <p:nvSpPr>
        <p:cNvPr id="${1000 + idx}" name="VeloxaWatermarkText${idx}"/>
        <p:cNvSpPr txBox="1"/>
        <p:nvPr/>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm rot="${rotation}">
          <a:off x="${x}" y="${y}"/>
          <a:ext cx="${cx}" cy="${cy}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        <a:noFill/>
      </p:spPr>
      <p:txBody>
        <a:bodyPr wrap="none" rtlCol="0" anchor="${anchor}"/>
        <a:lstStyle/>
        <a:p>
          <a:pPr algn="${algn}"/>
          <a:r>
            <a:rPr lang="en-US" sz="${sizeHundredths}" b="${bold}" i="${italic}">
              <a:solidFill>
                <a:srgbClr val="${colorHex}"><a:alpha val="${opacity}"/></a:srgbClr>
              </a:solidFill>
              <a:latin typeface="${escapeXml(profile.fontFamily || 'Arial')}"/>
            </a:rPr>
            <a:t>${text}</a:t>
          </a:r>
        </a:p>
      </p:txBody>
    </p:sp>`;
}

function buildImageShape(relId, idx, slideW, slideH, profile, imgWidth, imgHeight) {
  const opacity = Math.round(Math.max(0, Math.min(1, profile.opacity ?? 1)) * 100000);
  const rotation = (profile.rotation ?? 0) * 60000;

  const { cx, cy } = shapeSize(profile, slideW, slideH, 'image', imgWidth, imgHeight);
  const marginEmu = Math.round((profile.margin ?? 36) * PT_TO_EMU);
  const offsetXEmu = Math.round((profile.offsetX || 0) * PT_TO_EMU);
  const offsetYEmu = Math.round((profile.offsetY || 0) * PT_TO_EMU);
  const { x, y } = placeShape(
    { position: profile.position, marginEmu, offsetXEmu, offsetYEmu },
    slideW, slideH, cx, cy,
  );

  return `
    <p:pic>
      <p:nvPicPr>
        <p:cNvPr id="${2000 + idx}" name="VeloxaWatermarkImg${idx}"/>
        <p:cNvPicPr/>
        <p:nvPr/>
      </p:nvPicPr>
      <p:blipFill>
        <a:blip r:embed="${relId}">
          <a:alphaModFix amt="${opacity}"/>
        </a:blip>
        <a:stretch><a:fillRect/></a:stretch>
      </p:blipFill>
      <p:spPr>
        <a:xfrm rot="${rotation}">
          <a:off x="${x}" y="${y}"/>
          <a:ext cx="${cx}" cy="${cy}"/>
        </a:xfrm>
        <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      </p:spPr>
    </p:pic>`;
}

function readPresentationSize(zip) {
  const xml = zip.file('ppt/presentation.xml')?.asText() || '';
  const m = /<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/.exec(xml);
  return m ? { cx: parseInt(m[1], 10), cy: parseInt(m[2], 10) } : { cx: 9144000, cy: 6858000 };
}

function listSlidePaths(zip) {
  return Object.keys(zip.files).filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
}

function ensureContentTypes(zip, exts) {
  const ctPath = '[Content_Types].xml';
  let xml = zip.file(ctPath)?.asText() || '';
  for (const ext of exts) {
    if (!new RegExp(`Extension="${ext}"`).test(xml)) {
      xml = xml.replace('</Types>', `<Default Extension="${ext}" ContentType="image/${ext === 'jpg' ? 'jpeg' : ext}"/></Types>`);
    }
  }
  zip.file(ctPath, xml);
}

function relsPathFor(slidePath) {
  const file = slidePath.split('/').pop();
  return `ppt/slides/_rels/${file}.rels`;
}

function addImageRel(zip, slidePath, target, relId) {
  const p = relsPathFor(slidePath);
  let xml = zip.file(p)?.asText();
  if (!xml) {
    xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  }
  if (xml.includes(`Id="${relId}"`)) return;
  const rel = `<Relationship Id="${relId}" Type="${IMAGE_REL_TYPE}" Target="${target}"/>`;
  xml = xml.replace('</Relationships>', `${rel}</Relationships>`);
  zip.file(p, xml);
}

function injectShapesIntoSlide(zip, slidePath, shapesXml) {
  let xml = zip.file(slidePath)?.asText();
  if (!xml) return;
  // Append before closing spTree
  xml = xml.replace(/<\/p:spTree>/, `${shapesXml}</p:spTree>`);
  zip.file(slidePath, xml);
}

async function processPptx({ inputPath, outputPath, profile }) {
  const zip = await readZip(inputPath);
  const { cx: slideW, cy: slideH } = readPresentationSize(zip);
  const slides = listSlidePaths(zip);
  if (!slides.length) {
    await writeZip(zip, outputPath);
    return { outputPath };
  }

  // Filter by pages setting
  let targetSlides = slides;
  if (profile.pages === 'first') targetSlides = [slides[0]];
  else if (profile.pages === 'last') targetSlides = [slides[slides.length - 1]];
  else if (profile.pages === 'custom') {
    const set = new Set();
    String(profile.customPages || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((token) => {
        const range = token.split('-').map((n) => parseInt(n, 10));
        if (range.length === 1 && Number.isFinite(range[0])) set.add(range[0] - 1);
        else if (range.length === 2) for (let i = range[0]; i <= range[1]; i += 1) set.add(i - 1);
      });
    targetSlides = slides.filter((_, i) => set.has(i));
  }

  let img = null;
  if (profile.type === 'image' || profile.type === 'combined') {
    img = await readImage(profile.logoPath);
    if (img) {
      const mediaName = `veloxa_logo.${img.ext}`;
      zip.file(`ppt/media/${mediaName}`, img.data);
      ensureContentTypes(zip, [img.ext]);
    }
  }

  for (let i = 0; i < targetSlides.length; i += 1) {
    const slidePath = targetSlides[i];
    let shapes = '';

    if (img) {
      const relId = `rIdVeloxaImg${i}`;
      addImageRel(zip, slidePath, `../media/veloxa_logo.${img.ext}`, relId);
      shapes += buildImageShape(relId, i, slideW, slideH, profile, img.width, img.height);
    }
    if ((profile.type === 'text' || profile.type === 'combined') && profile.text) {
      shapes += buildTextShape(profile, i, slideW, slideH);
    }
    if (shapes) injectShapesIntoSlide(zip, slidePath, shapes);
  }

  await writeZip(zip, outputPath);
  return { outputPath, slides: targetSlides.length };
}

module.exports = { processPptx };
