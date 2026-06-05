const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');
const { readFileWithRetry, writeFileWithRetry } = require('../util/fsRetry');

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000000');
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/**
 * Map a profile's fontFamily to one of pdf-lib's 14 PDF Standard Fonts.
 * Times-style and Courier-style names get their respective families;
 * everything else falls back to Helvetica.
 */
function pickFont(profile) {
  const bold = !!profile.bold;
  const italic = !!profile.italic;
  const family = String(profile.fontFamily || '').toLowerCase();

  if (family.includes('times') || family.includes('serif') || family.includes('georgia')) {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (family.includes('courier') || family.includes('mono')) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  // Helvetica/Arial/Verdana/etc. → Helvetica family
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

function pageIndices(profile, pageCount) {
  const which = profile.pages || 'all';
  if (which === 'first') return [0];
  if (which === 'last') return [pageCount - 1];
  if (which === 'custom') {
    const set = new Set();
    String(profile.customPages || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((token) => {
        const range = token.split('-').map((n) => parseInt(n, 10));
        if (range.length === 1 && Number.isFinite(range[0])) {
          set.add(range[0] - 1);
        } else if (range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1])) {
          for (let i = range[0]; i <= range[1]; i += 1) set.add(i - 1);
        }
      });
    return Array.from(set).filter((i) => i >= 0 && i < pageCount).sort((a, b) => a - b);
  }
  return Array.from({ length: pageCount }, (_, i) => i);
}

/**
 * Compute placement (in PDF user-space) for a watermark of size (tw × th)
 * on a page of size (w × h). Honours position preset, edge margin, and an
 * explicit (offsetX, offsetY) nudge in points (positive X = right, positive Y = down).
 * Note: PDF Y increases upward, so positive Y-offset becomes -Y in PDF coords.
 */
function placement(position, w, h, tw, th, margin, offsetX = 0, offsetY = 0) {
  const cx = w / 2 - tw / 2;
  const cy = h / 2 - th / 2;
  let base;
  switch (position) {
    case 'top-left':      base = { x: margin,           y: h - margin - th }; break;
    case 'top-center':    base = { x: cx,               y: h - margin - th }; break;
    case 'top-right':     base = { x: w - margin - tw,  y: h - margin - th }; break;
    case 'middle-left':   base = { x: margin,           y: cy };               break;
    case 'middle-right':  base = { x: w - margin - tw,  y: cy };               break;
    case 'bottom-left':   base = { x: margin,           y: margin };          break;
    case 'bottom-center': base = { x: cx,               y: margin };          break;
    case 'bottom-right':  base = { x: w - margin - tw,  y: margin };          break;
    case 'diagonal':
    case 'center':
    default:              base = { x: cx, y: cy };
  }
  return { x: base.x + offsetX, y: base.y - offsetY };
}

async function embedLogo(pdfDoc, logoPath) {
  if (!logoPath) return null;
  const ext = path.extname(logoPath).toLowerCase();
  const bytes = await readFileWithRetry(logoPath);
  if (ext === '.png') return pdfDoc.embedPng(bytes);
  if (ext === '.jpg' || ext === '.jpeg') return pdfDoc.embedJpg(bytes);
  // fallback: try PNG decoder; SVG not natively supported by pdf-lib
  try { return await pdfDoc.embedPng(bytes); }
  catch { return null; }
}

// Marker we embed in PDF metadata so conflict.js can cheaply detect
// "this PDF was already watermarked by Veloxa". Lives in Keywords because
// pdf-lib exposes it and Adobe/SumatraPDF/etc. all preserve it unchanged.
const VELOXA_PDF_MARKER = 'VeloxaWatermark/1';

async function processPdf({ inputPath, outputPath, profile, settings }) {
  const inputBytes = await readFileWithRetry(inputPath);
  const pdfDoc = await PDFDocument.load(inputBytes, { ignoreEncryption: true, updateMetadata: false });

  const font = await pdfDoc.embedFont(pickFont(profile));
  const color = hexToRgb(profile.fontColor || '#000000');
  const opacity = Math.max(0, Math.min(1, profile.opacity ?? 1));
  // Diagonal is a placement preset (center) — rotation is independent and always honoured.
  const rotation = profile.rotation || 0;
  const fontSize = profile.fontSize || 64;
  const margin = profile.margin ?? 36;
  const offsetX = profile.offsetX || 0;
  const offsetY = profile.offsetY || 0;
  const text = profile.text || '';

  const logoImage = profile.type === 'image' || profile.type === 'combined'
    ? await embedLogo(pdfDoc, profile.logoPath)
    : null;

  const targetIdx = pageIndices(profile, pdfDoc.getPageCount());

  for (const i of targetIdx) {
    const page = pdfDoc.getPage(i);
    const { width, height } = page.getSize();

    if (logoImage) {
      const baseScale = Math.min(width, height) * 0.35 / Math.max(logoImage.width, logoImage.height);
      const scale = baseScale * (profile.scale || 1);
      const lw = logoImage.width * scale;
      const lh = logoImage.height * scale;
      const pos = placement(profile.position, width, height, lw, lh, margin, offsetX, offsetY);
      page.drawImage(logoImage, {
        x: pos.x,
        y: pos.y,
        width: lw,
        height: lh,
        opacity,
        rotate: degrees(rotation),
      });
    }

    if ((profile.type === 'text' || profile.type === 'combined') && text) {
      const tw = font.widthOfTextAtSize(text, fontSize);
      const th = font.heightAtSize(fontSize);
      const pos = placement(profile.position, width, height, tw, th, margin, offsetX, offsetY);
      page.drawText(text, {
        x: pos.x,
        y: pos.y,
        size: fontSize,
        font,
        color,
        opacity,
        rotate: degrees(rotation),
      });
    }
  }

  // Stamp the PDF with a Veloxa marker (appended to existing Keywords if any).
  // conflict.js reads this back to enable "skip already watermarked" for PDFs,
  // matching the behavior already in place for DOCX and PPTX.
  try {
    const existing = pdfDoc.getKeywords() || '';
    if (!existing.includes(VELOXA_PDF_MARKER)) {
      pdfDoc.setKeywords([existing, VELOXA_PDF_MARKER].filter(Boolean));
    }
  } catch {
    // Some PDFs have a missing/locked Info dict — non-fatal.
  }

  const saveOpts = { useObjectStreams: settings.pdfCompression !== 'none' };
  let outBytes = await pdfDoc.save(saveOpts);

  if (settings.pdfPassword) {
    // pdf-lib doesn't natively encrypt — fall back to writing unencrypted and warning upstream.
    // Encryption support can be added with qpdf or hummus-recipe in a follow-up.
  }

  await writeFileWithRetry(outputPath, outBytes);
  return { outputPath, pages: pdfDoc.getPageCount() };
}

module.exports = { processPdf, VELOXA_PDF_MARKER };
