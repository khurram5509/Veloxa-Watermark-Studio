/**
 * PDF converter — orchestrator over multiple backends.
 *
 * Backends (in priority order for DOCX/PPTX):
 *   1. Microsoft Office COM (Word / PowerPoint) — Windows + Office only
 *      ↳ fastest, native fidelity, no extra install for Office users
 *   2. LibreOffice (soffice --convert-to pdf) — cross-platform fallback
 *
 * Public API matches the old single-backend module so callers (queue,
 * validation, IPC handlers, backend) don't need to change.
 *
 * The user can override the auto-selection via settings.pdfConverter:
 *   'auto'        → prefer MS Office for DOCX/PPTX, else LibreOffice (default)
 *   'msoffice'    → MS Office only, fail if unavailable
 *   'libreoffice' → LibreOffice only, fail if unavailable
 */
const path = require('node:path');
const libreoffice = require('./converters/libreoffice');
const msoffice = require('./converters/msoffice');

let _statusCache = null;

async function status(refresh = false) {
  if (_statusCache && !refresh) return _statusCache;
  const [lo, mo] = await Promise.all([
    libreoffice.status(refresh),
    msoffice.status(refresh),
  ]);
  const backends = [];
  if (mo.word) backends.push(`Microsoft Word ${mo.wordVersion || ''}`.trim());
  if (mo.powerpoint) backends.push(`Microsoft PowerPoint ${mo.powerpointVersion || ''}`.trim());
  if (lo.available) backends.push(`LibreOffice ${lo.version || ''}`.trim());

  // Choose a sensible "active" backend label for the UI
  let active = null;
  if (mo.word || mo.powerpoint) active = 'msoffice';
  else if (lo.available) active = 'libreoffice';

  _statusCache = {
    available: !!(lo.available || mo.available),
    active,
    backends,
    msoffice: mo,
    libreoffice: lo,
    // Backwards-compat fields (older renderer/UI code reads these)
    path: lo.path || null,
    version: lo.version || null,
    error: !lo.available && !mo.available
      ? 'No PDF converter found (install Microsoft Office or LibreOffice)'
      : null,
  };
  return _statusCache;
}

function isAvailable() {
  return !!(_statusCache && _statusCache.available);
}

/**
 * Pick the right backend for a given file extension and the user's
 * preference setting, then perform the conversion.
 */
async function convertToPdf(inputPath, outputPath, options = {}) {
  const ext = path.extname(inputPath).toLowerCase().replace('.', '');
  const preference = options.preference || 'auto'; // 'auto' | 'msoffice' | 'libreoffice'
  const quality = options.quality || 'standard';   // 'standard' | 'high'

  // Make sure status is warm
  await status();

  const tryMsOffice = async () => {
    if (!msoffice.isAvailable(ext)) {
      throw new Error(`Microsoft Office COM not available for .${ext}`);
    }
    return msoffice.convertToPdf(inputPath, outputPath, { quality });
  };
  const tryLibreOffice = async () => {
    if (!libreoffice.isAvailable()) {
      throw new Error('LibreOffice not available');
    }
    return libreoffice.convertToPdf(inputPath, outputPath, { quality });
  };

  if (preference === 'msoffice') return tryMsOffice();
  if (preference === 'libreoffice') return tryLibreOffice();

  // 'auto' — prefer MS Office for the formats it supports, fall back gracefully
  if ((ext === 'docx' || ext === 'pptx') && msoffice.isAvailable(ext)) {
    try {
      return await tryMsOffice();
    } catch (err) {
      // If COM call fails for some Office runtime reason, fall through to LO
      if (libreoffice.isAvailable()) return tryLibreOffice();
      throw err;
    }
  }
  if (libreoffice.isAvailable()) return tryLibreOffice();
  throw new Error(
    `No PDF converter available for .${ext}. Install Microsoft Office or LibreOffice and reopen the app.`,
  );
}

module.exports = {
  status,
  isAvailable,
  convertToPdf,
  // Re-export per-backend modules for advanced use / tests
  backends: { msoffice, libreoffice },
};
