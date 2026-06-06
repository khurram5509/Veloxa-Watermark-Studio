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
  # AutomationSecurity 3 = msoAutomationSecurityForceDisable — silently
  # blocks macros so VBA AutoOpen / Document_Open routines can't pop modal
  # dialogs that would deadlock the COM call. The earlier code only set
  # DisplayAlerts, which suppresses runtime warnings but not macro-driven
  # MsgBox / file-locked-by-another-user / "Enable Editing" Protected
  # View prompts.
  try { $word.AutomationSecurity = 3 } catch {}
  # Skip slow per-file behaviors that Word does by default and that don't
  # affect the PDF we ultimately export. Each shaves real wall-clock time
  # off large docs and one of them (UpdateLinksAtOpen) blocks if a linked
  # file is unreachable.
  try { $word.Options.UpdateLinksAtOpen = $false } catch {}
  try { $word.Options.SaveNormalPrompt = $false } catch {}
  try { $word.Options.CheckGrammarAsYouType = $false } catch {}
  try { $word.Options.CheckSpellingAsYouType = $false } catch {}
  # Documents.Open signature (positional):
  #   FileName, ConfirmConversions, ReadOnly, AddToRecentFiles,
  #   PasswordDocument, PasswordTemplate, Revert, WritePasswordDocument,
  #   WritePasswordTemplate, Format, Encoding, Visible, OpenAndRepair,
  #   DocumentDirection, NoEncodingDialog, XMLTransform
  # OpenAndRepair=$true rescues mildly-corrupt docs that would otherwise
  # throw "The file is corrupt" without manual user intervention.
  $doc = $word.Documents.Open(
    "${psEscape(input)}",
    $false, $true, $false,
    [Type]::Missing, [Type]::Missing, $false,
    [Type]::Missing, [Type]::Missing, [Type]::Missing, [Type]::Missing,
    $false,
    $true
  );
  # Protected View bypass: documents synced from Dropbox / OneDrive /
  # downloaded via browser carry MOTW (Mark-of-the-Web). Word opens them
  # in Protected View by default, which lets us read but refuses
  # ExportAsFixedFormat. Calling Edit() forces it into a fully-trusted
  # editable state. Wrapped in try/catch because the call no-ops on docs
  # NOT in Protected View — calling Edit() there throws.
  try { if ($doc.ProtectedViewWindow) { $doc = $doc.ProtectedViewWindow.Edit() } } catch {}
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
  # AutomationSecurity 3 = msoAutomationSecurityForceDisable — same Protected
  # View / macro suppression rationale as the Word path.
  try { $ppt.AutomationSecurity = 3 } catch {}
  # PowerPoint can't fully hide its window on most versions — leave default
  # Presentations.Open(FileName, ReadOnly, Untitled, WithWindow)
  # ReadOnly=msoTrue avoids autosave / lock prompts on Dropbox-synced files.
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

// Extract the structured `{ok:false, error:"..."}` JSON the WORD/POWERPOINT
// scripts emit on failure. The previous regex-only path missed nested braces
// (e.g. error strings containing `{` from Word's exception text) and any
// time the JSON wrapped onto multiple lines, so users saw "exit 1" without
// the actual Office error. This walks each non-empty stdout line, JSON-parses,
// and returns the first parseable `{ok:false}` it finds.
function extractStructuredError(stdout) {
  if (!stdout) return null;
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && parsed.ok === false && parsed.error) return String(parsed.error);
    } catch { /* try next line */ }
  }
  return null;
}

// Best-effort MOTW (Mark-of-the-Web) strip on the input file. When files
// originate from a download / sync / network share, Windows attaches a
// `:Zone.Identifier` alternate data stream so Office treats them as
// "potentially unsafe" and opens them in Protected View — which then
// blocks ExportAsFixedFormat. Removing the ADS opens Word's edit path.
// No-op + silent if the file has no ADS (the common case for fresh writes).
function stripMOTW(p) {
  try { fs.unlinkSync(p + ':Zone.Identifier'); } catch { /* not present, fine */ }
}

// COM RPC blips, "Documents already in use", or a winword.exe that didn't
// release between fast-fire calls all look like transient exit-1 failures
// the second attempt clears. Errors that are deterministic (file actually
// missing, file corrupt, file password-protected) won't be helped by a
// retry, but they don't get hurt either — they fail the same way faster.
function isTransientCOMError(message) {
  if (!message) return false;
  return /RPC|0x800[A-F0-9]{5}|already in use|server execution failed|busy|locked|access denied|in use by another/i.test(message);
}

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

  // Strip MOTW so Word doesn't put the doc into Protected View (which
  // refuses programmatic ExportAsFixedFormat). Best-effort; if the ADS
  // isn't present, the call no-ops silently.
  stripMOTW(absIn);

  // If a prior failed convert left a partial .pdf in the output path,
  // Word's ExportAsFixedFormat throws "the file is in use" instead of
  // overwriting. Clear it before re-attempting.
  if (fs.existsSync(absOut)) {
    try { fs.unlinkSync(absOut); } catch { /* will surface as the real failure below */ }
  }

  const script = ext === 'docx'
    ? WORD_SCRIPT(absIn, absOut, quality)
    : POWERPOINT_SCRIPT(absIn, absOut, quality);

  const appName = ext === 'docx' ? 'Microsoft Word' : 'Microsoft PowerPoint';

  // One retry on transient COM errors. ~1 s pause between attempts gives
  // a stuck winword.exe / ppt.exe time to release. Bounded at 2 attempts
  // total so a genuinely-broken file doesn't double its already-long
  // failure wall-clock.
  const MAX_ATTEMPTS = 2;
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let stdout;
    try {
      stdout = await runPowerShell(script, 180_000);
    } catch (err) {
      // PowerShell exited non-zero — extract the structured Office error
      // first (much better UX than "PowerShell exited with code 1"), then
      // decide whether to retry.
      const structured = extractStructuredError(err.stdout);
      const message = structured || err.message || 'unknown';
      lastErr = new Error(`${appName} convert failed: ${message}`);

      if (attempt < MAX_ATTEMPTS && isTransientCOMError(message)) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw lastErr;
    }

    // Even on exit 0, defensively parse the JSON to confirm success.
    const structuredErr = extractStructuredError(stdout);
    if (structuredErr) {
      lastErr = new Error(`${appName} convert failed: ${structuredErr}`);
      if (attempt < MAX_ATTEMPTS && isTransientCOMError(structuredErr)) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw lastErr;
    }

    if (!fs.existsSync(absOut)) {
      lastErr = new Error(`${appName} reported success but output not found: ${absOut}`);
      // Treat missing-output as transient — Office sometimes returns
      // before the file is fully flushed to disk.
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500));
        if (fs.existsSync(absOut)) return absOut;
        continue;
      }
      throw lastErr;
    }

    return absOut;
  }

  // Should be unreachable — every loop iteration either returns or throws.
  throw lastErr || new Error(`${appName} convert failed: exhausted retries`);
}

module.exports = {
  status,
  isAvailable,
  convertToPdf,
  // exposed for tests
  extractStructuredError,
  isTransientCOMError,
  stripMOTW,
};
