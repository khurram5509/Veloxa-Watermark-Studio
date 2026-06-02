/**
 * LibreOffice headless converter backend.
 *
 * Shells out to `soffice --convert-to pdf`. Auto-detects the binary on launch
 * from common install paths + $PATH; cached after the first probe.
 *
 * Cross-platform — works on Windows, macOS, and Linux.
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

let _cache = null;

function candidatePaths() {
  const list = [];
  if (process.platform === 'win32') {
    list.push(
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
      'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    );
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      `${os.homedir()}/Applications/LibreOffice.app/Contents/MacOS/soffice`,
    );
  } else {
    list.push(
      '/usr/bin/soffice',
      '/usr/local/bin/soffice',
      '/usr/bin/libreoffice',
      '/usr/local/bin/libreoffice',
      '/opt/libreoffice/program/soffice',
    );
  }
  return list;
}

function findInPath() {
  const pathEnv = process.env.PATH || '';
  const sep = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? ['.exe', '.com', '.bat', '.cmd'] : [''];
  const names = ['soffice', 'libreoffice'];
  for (const dir of pathEnv.split(sep).filter(Boolean)) {
    for (const name of names) {
      for (const ext of exts) {
        const candidate = path.join(dir, name + ext);
        try {
          if (fs.statSync(candidate).isFile()) return candidate;
        } catch {}
      }
    }
  }
  return null;
}

function findSoffice() {
  for (const c of candidatePaths()) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return findInPath();
}

function probeVersion(sofficePath) {
  return new Promise((resolve) => {
    execFile(sofficePath, ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = String(stdout).match(/LibreOffice\s+([\d.]+)/i);
      resolve(m ? m[1] : String(stdout).trim().slice(0, 64));
    });
  });
}

async function status(refresh = false) {
  if (_cache && !refresh) return _cache;
  const sof = findSoffice();
  if (!sof) {
    _cache = { available: false, path: null, version: null, error: 'LibreOffice (soffice) not found' };
    return _cache;
  }
  const version = await probeVersion(sof);
  _cache = { available: true, path: sof, version };
  return _cache;
}

function isAvailable() {
  return !!(_cache && _cache.available);
}

// Build the soffice --convert-to filter spec with quality settings.
// Args reference: https://wiki.openoffice.org/wiki/API/Tutorials/PDF_export
function buildConvertSpec(quality) {
  if (quality === 'high') {
    // Lossless JPEG for embedded raster images, no resolution downsampling,
    // embed standard fonts, tag PDF for accessibility.
    const params = [
      'UseLossless=true',
      'Quality=100',
      'ReduceImageResolution=false',
      'MaxImageResolution=600',
      'EmbedStandardFonts=true',
      'ExportNotes=false',
      'TaggedPDF=true',
      'SelectPdfVersion=15',  // PDF 1.5 — broadly compatible
    ].join(':');
    return `pdf:writer_pdf_Export:${params}`;
  }
  // 'standard' — smaller file, JPEG q75 with downsampling at 150 DPI
  const params = [
    'UseLossless=false',
    'Quality=75',
    'ReduceImageResolution=true',
    'MaxImageResolution=150',
    'EmbedStandardFonts=true',
    'ExportNotes=false',
  ].join(':');
  return `pdf:writer_pdf_Export:${params}`;
}

async function convertToPdf(inputPath, outputPath, options = {}) {
  const st = await status();
  if (!st.available) {
    throw new Error(`LibreOffice unavailable: ${st.error || 'not found'}`);
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Convert source not found: ${inputPath}`);
  }
  const quality = options.quality || 'standard';
  const convertSpec = buildConvertSpec(quality);
  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'veloxa-lo-'));
  try {
    await new Promise((resolve, reject) => {
      const profileDir = `-env:UserInstallation=file:///${stagingDir.replace(/\\/g, '/')}/profile`;
      execFile(
        st.path,
        [
          profileDir,
          '--headless',
          '--norestore',
          '--nologo',
          '--nofirststartwizard',
          '--convert-to', convertSpec,
          '--outdir', stagingDir,
          inputPath,
        ],
        { timeout: 120_000, windowsHide: true },
        (err, _stdout, stderr) => {
          if (err) reject(new Error(`soffice convert failed: ${err.message}${stderr ? `\n${stderr}` : ''}`));
          else resolve();
        },
      );
    });

    const stagedName = path.basename(inputPath, path.extname(inputPath)) + '.pdf';
    const stagedPath = path.join(stagingDir, stagedName);
    if (!fs.existsSync(stagedPath)) {
      throw new Error(`LibreOffice ran but output not found: ${stagedPath}`);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    try {
      await fsp.rename(stagedPath, outputPath);
    } catch {
      await fsp.copyFile(stagedPath, outputPath);
      try { await fsp.unlink(stagedPath); } catch {}
    }
    return outputPath;
  } finally {
    try { await fsp.rm(stagingDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { status, isAvailable, convertToPdf, findSoffice };
