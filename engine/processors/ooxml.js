/**
 * Shared OOXML helpers for DOCX/PPTX watermark injection.
 * Both formats are ZIP packages containing XML parts.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const PizZip = require('pizzip');

async function readZip(p) {
  const buf = await fs.readFile(p);
  return new PizZip(buf);
}

async function writeZip(zip, dest) {
  const out = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  await fs.writeFile(dest, out);
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ensureFolder(zip, folder) {
  // PizZip doesn't track empty folders explicitly, no-op needed
  return folder;
}

async function readImage(logoPath) {
  if (!logoPath) return null;
  const ext = path.extname(logoPath).toLowerCase().replace('.', '') || 'png';
  const data = await fs.readFile(logoPath);
  const dims = readImageSize(data);
  return { ext: ext === 'jpg' ? 'jpeg' : ext, data, width: dims?.width, height: dims?.height };
}

/**
 * Read intrinsic pixel dimensions from a PNG or JPEG buffer by parsing headers.
 * Avoids pulling in `sharp` / `image-size` for a one-off lookup.
 * Returns null if the format isn't recognized.
 */
function readImageSize(buf) {
  if (!buf || buf.length < 24) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A; IHDR length=13 starts at byte 8;
  // width/height are big-endian uint32 at offsets 16 and 20.
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // JPEG: starts with FF D8. Walk segments looking for SOFn (FFC0..FFCF
  // except FFC4/FFC8/FFCC which are DHT/JPG/DAC, not frame markers).
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) return null;
      // skip fill bytes (0xFF padding)
      while (buf[i] === 0xFF && i < buf.length - 1) i += 1;
      const marker = buf[i];
      i += 1;
      if (marker === 0xD8 || marker === 0xD9) return null; // SOI/EOI mid-stream → bail
      if (marker >= 0xD0 && marker <= 0xD7) continue;       // RSTn — no length
      if (i + 1 >= buf.length) return null;
      const segLen = buf.readUInt16BE(i);
      const isSOF = marker >= 0xC0 && marker <= 0xCF
        && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
      if (isSOF && i + 7 < buf.length) {
        return { height: buf.readUInt16BE(i + 3), width: buf.readUInt16BE(i + 5) };
      }
      i += segLen;
    }
  }
  return null;
}

module.exports = { readZip, writeZip, escapeXml, ensureFolder, readImage, readImageSize };
