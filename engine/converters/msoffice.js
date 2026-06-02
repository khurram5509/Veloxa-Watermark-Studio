/**
 * Microsoft Office COM converter backend (Windows-only).
 *
 * Drives Word and PowerPoint via PowerShell COM automation to convert
 * DOCX/PPTX → PDF using Office's own engines. No extra dependency for
 * users who already have Office installed.
 *
 * Pros vs LibreOffice:
 *   - No extra ~300 MB install for the typical Windows user
 *   - Native fidelity (Office files always render best in Office)
 *   - Comparable speed (~2s/file Word, similar for PowerPoint)
 *
 * Cons:
 *   - Windows + Office only
 *   - Not service-account safe (interactive desktop session needed)
 *   - DOCX → Word, PPTX → PowerPoint (no XLSX support unless Excel is added)
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let _cache = null;

const POWERSHELL = 'powershell.exe';

/**
 * Run a PowerShell script. Uses `spawn` (not execFile) so we can correctly
 * distinguish a real failure (non-zero exit) from PowerShell's harmless
 * CLIXML stderr preamble that fires under -NonInteractive. Pass the script
 * via -EncodedCommand (base64-encoded UTF-16 LE) so multi-line scripts and
 * special chars survive Windows shell parsing.
 */
function runPowerShell(script, timeoutMs = 60_000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(
      POWERSHELL,
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded,
      ],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });

    const killer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`PowerShell timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(killer);
      reject(new Error(`PowerShell failed to launch: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      // Strip PowerShell's CLIXML preamble from stderr so it doesn't
      // leak into our error messages when there's a real failure.
      const cleanErr = stderr.replace(/^#<\s*CLIXML[\s\S]*$/m, '').trim();
      if (code === 0) {
        resolve(stdout);
      } else {
        const err = new Error(`PowerShell exited with code ${code}${cleanErr ? `: ${cleanErr.slice(0, 400)}` : ''}`);
        // Attach stdout so the caller can extract the structured error
        // (the script writes JSON {ok:false,error:...} on failure paths).
        err.stdout = stdout;
        err.stderr = cleanErr;
        reject(err);
      }
    });
  });
}

const PROBE_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue';
$result = New-Object PSObject -Property @{
  word = $false;
  wordVersion = $null;
  powerpoint = $false;
  powerpointVersion = $null;
};
try {
  $w = New-Object -ComObject Word.Application;
  $result.word = $true;
  $result.wordVersion = [string]$w.Version;
  $w.Quit();
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($w) | Out-Null;
  Remove-Variable w;
} catch {}
try {
  $p = New-Object -ComObject PowerPoint.Application;
  $result.powerpoint = $true;
  $result.powerpointVersion = [string]$p.Version;
  $p.Quit();
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($p) | Out-Null;
  Remove-Variable p;
} catch {}
[GC]::Collect();
[GC]::WaitForPendingFinalizers();
$result | ConvertTo-Json -Compress;
`;

async function status(refresh = false) {
  if (_cache && !refresh) return _cache;
  if (process.platform !== 'win32') {
    _cache = { available: false, word: false, powerpoint: false, error: 'COM is Windows-only' };
    return _cache;
  }
  try {
    // Office COM startup is slow on cold boots — give it 90s.
    const stdout = await runPowerShell(PROBE_SCRIPT, 90_000);
    // Trim BOM + whitespace; the probe might emit progress info before our JSON.
    // Take the LAST non-empty line as the JSON payload (most defensive).
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const jsonLine = lines.reverse().find((l) => l.startsWith('{'));
    if (!jsonLine) throw new Error(`No JSON in PowerShell output: ${stdout.slice(0, 200)}`);
    const parsed = JSON.parse(jsonLine.replace(/^﻿/, ''));
    _cache = {
      available: !!(parsed.word || parsed.powerpoint),
      word: !!parsed.word,
      wordVersion: parsed.wordVersion || null,
      powerpoint: !!parsed.powerpoint,
      powerpointVersion: parsed.powerpointVersion || null,
    };
  } catch (err) {
    _cache = {
      available: false,
      word: false,
      powerpoint: false,
      error: (err && err.message) ? err.message.slice(0, 300) : 'PowerShell probe failed',
    };
  }
  return _cache;
}

function isAvailable(format) {
  if (!_cache) return false;
  if (!format) return _cache.available;
  if (format === 'docx' || format === '.docx') return !!_cache.word;
  if (format === 'pptx' || format === '.pptx') return !!_cache.powerpoint;
  return false;
}

// Escape a path for embedding inside a PowerShell double-quoted string.
// Single-quoted is simpler but breaks if path contains a single-quote.
// Backtick-escape the special chars.
function psEscape(p) {
  return String(p)
    .replace(/`/g, '``')
    .replace(/\$/g, '`$')
    .replace(/"/g, '`"');
}

// Both scripts emit a single line of JSON on stdout — `{"ok":true}` or
// `{"ok":false,"error":"..."}` — so Node can read the actual COM error
// instead of just "PowerShell exited with code 1". Avoids losing the
// real cause to PowerShell's CLIXML stderr stream.
//
// We use ExportAsFixedFormat (not SaveAs) because it exposes the
// OptimizeFor flag — 0 = print quality (high), 1 = screen quality (smaller).
// This is how the Office UI's "PDF" save-as dialog drives quality too.
const WORD_SCRIPT = (input, output, quality) => {
  // Word.WdExportOptimizeFor: 0 = wdExportOptimizeForPrint, 1 = wdExportOptimizeForOnScreen
  const optimizeFor = quality === 'high' ? 0 : 1;
  return `
$ErrorActionPreference = 'Stop';
$word = $null; $doc = $null;
$err = $null;
try {
  $word = New-Object -ComObject Word.Application;
  $word.Visible = $false;
  $word.DisplayAlerts = 0;
  $doc = $word.Documents.Open("${psEscape(input)}", $false, $true, $false);
  # Word.WdExportFormat.wdExportFormatPDF = 17
  # OptimizeFor: 0 = print (high quality), 1 = screen (smaller file)
  # IncludeDocProps: $true; KeepIRM: $true; CreateBookmarks: 0 (none)
  # DocStructureTags: $true; BitmapMissingFonts: $true; UseISO19005_1: $false
  $doc.ExportAsFixedFormat("${psEscape(output)}", 17, $false, ${optimizeFor}, 0, 0, 0, 0, $true, $true, 0, $true, $true, $false);
  $doc.Close($false);
} catch {
  $err = $_.Exception.Message;
} finally {
  if ($doc) {
    try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($doc) | Out-Null } catch {}
  }
  if ($word) {
    try { $word.Quit() } catch {}
    try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers();
}
if ($err) { Write-Output (@{ ok = $false; error = $err } | ConvertTo-Json -Compress); exit 1 }
else { Write-Output '{"ok":true}'; exit 0 }
`;
};

// PowerPoint quirk: ExportAsFixedFormat (which would expose the Intent /
// quality flag) can't be invoked through PowerShell's COM marshalling — the
// typelib's MsoTriState/Object parameter types reject every PowerShell value
// shape we tried (int, bool, [int]-cast, reflection InvokeMember). SaveAs(32)
// is the only reliable invocation, but it doesn't expose quality. So PPTX
// conversion is fixed at PowerPoint's default rendering quality. The Word
// path still respects the quality setting via ExportAsFixedFormat.
//
// `quality` is accepted for API symmetry but ignored for PowerPoint.
// eslint-disable-next-line no-unused-vars
const POWERPOINT_SCRIPT = (input, output, _quality) => `
$ErrorActionPreference = 'Stop';
$ppt = $null; $pres = $null;
$err = $null;
try {
  $ppt = New-Object -ComObject PowerPoint.Application;
  # PowerPoint can't fully hide its window on most versions — leave default
  $pres = $ppt.Presentations.Open("${psEscape(input)}", $true, $false, $false);
  # PpSaveAsFileType.ppSaveAsPDF = 32
  $pres.SaveAs("${psEscape(output)}", 32);
  $pres.Close();
} catch {
  $err = $_.Exception.Message;
} finally {
  if ($pres) {
    try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($pres) | Out-Null } catch {}
  }
  if ($ppt) {
    try { $ppt.Quit() } catch {}
    try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($ppt) | Out-Null } catch {}
  }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers();
}
if ($err) { Write-Output (@{ ok = $false; error = $err } | ConvertTo-Json -Compress); exit 1 }
else { Write-Output '{"ok":true}'; exit 0 }
`;

async function convertToPdf(inputPath, outputPath, options = {}) {
  const quality = options.quality === 'high' ? 'high' : 'standard';
  const ext = path.extname(inputPath).toLowerCase().replace('.', '');
  if (!['docx', 'pptx'].includes(ext)) {
    throw new Error(`MS Office COM only handles .docx and .pptx (got .${ext})`);
  }
  const st = await status();
  if (ext === 'docx' && !st.word) {
    throw new Error('Microsoft Word COM is not available on this machine');
  }
  if (ext === 'pptx' && !st.powerpoint) {
    throw new Error('Microsoft PowerPoint COM is not available on this machine');
  }
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Convert source not found: ${inputPath}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  // Office requires absolute paths for SaveAs
  const absIn = path.resolve(inputPath);
  const absOut = path.resolve(outputPath);

  const script = ext === 'docx'
    ? WORD_SCRIPT(absIn, absOut, quality)
    : POWERPOINT_SCRIPT(absIn, absOut, quality);

  const appName = ext === 'docx' ? 'Microsoft Word' : 'Microsoft PowerPoint';
  let stdout;
  try {
    stdout = await runPowerShell(script, 180_000);
  } catch (err) {
    // PowerShell exited non-zero — script also wrote a JSON error to stdout.
    // err.message includes whatever stderr captured; check stdout for the
    // structured Office error too.
    if (err.stdout) {
      const m = String(err.stdout).match(/\{[^}]*"ok":\s*false[^}]*"error":\s*"([^"]+)"/);
      if (m) throw new Error(`${appName} convert failed: ${m[1]}`);
    }
    throw new Error(`${appName} convert failed: ${err.message}`);
  }

  // Even on exit 0, defensively parse the JSON to confirm success.
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
  const last = lines[lines.length - 1];
  if (last && last.startsWith('{')) {
    try {
      const parsed = JSON.parse(last);
      if (parsed.ok === false) throw new Error(`${appName} convert failed: ${parsed.error || 'unknown'}`);
    } catch (parseErr) {
      // Non-JSON output is fine if the file exists; surface the parse failure
      // only when nothing was produced.
      if (!fs.existsSync(absOut)) throw parseErr;
    }
  }

  if (!fs.existsSync(absOut)) {
    throw new Error(`${appName} reported success but output not found: ${absOut}`);
  }
  return absOut;
}

module.exports = { status, isAvailable, convertToPdf };
