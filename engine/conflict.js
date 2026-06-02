/**
 * Detect whether a file already has a Veloxa-applied watermark, so the
 * queue can skip (or warn before) re-watermarking. Lightweight: streams just
 * a head/tail window for PDFs, unzips structure-only for DOCX/PPTX.
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const PizZip = require('pizzip');
const { PDFDocument } = require('pdf-lib');
const { VELOXA_PDF_MARKER } = require('./processors/pdf');

async function hasVeloxaWatermark(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  try {
    if (ext === '.pdf') {
      // PDF: try cheap byte-grep first (works when Keywords is stored as
      // plain (...) literal — e.g. PDFs not using object streams), then fall
      // back to a pdf-lib load to read the Keywords entry properly. pdf-lib
      // encodes Keywords as UTF-16BE inside object streams, which the
      // byte-grep can't see.
      const buf = await fs.readFile(inputPath);
      if (buf.includes(VELOXA_PDF_MARKER)) return true;
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
      const kw = doc.getKeywords() || '';
      return kw.includes(VELOXA_PDF_MARKER);
    }
    const buf = await fs.readFile(inputPath);
    const zip = new PizZip(buf);
    if (ext === '.docx') {
      // Our DOCX processor writes word/header_veloxa.xml — its presence is
      // a sufficient marker.
      return !!zip.file('word/header_veloxa.xml');
    }
    if (ext === '.pptx') {
      const slidePaths = Object.keys(zip.files)
        .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
      for (const s of slidePaths) {
        const xml = zip.file(s).asText();
        if (xml.includes('VeloxaWatermarkText') || xml.includes('VeloxaWatermarkImg')) {
          return true;
        }
      }
    }
  } catch {
    // Corrupt zip / unreadable — treat as not-watermarked, the processor
    // itself will fail with a meaningful error.
  }
  return false;
}

module.exports = { hasVeloxaWatermark };
