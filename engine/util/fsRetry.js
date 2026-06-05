/**
 * Filesystem retry helper for transient EPERM / EBUSY / EACCES errors.
 *
 * These errors are common in two environments Veloxa runs in heavily:
 *
 *   1. Dropbox / OneDrive / Google Drive synced folders. The sync client
 *      briefly opens files for reading during upload — if our processor
 *      happens to ask for the same file at the same millisecond, fs.readFile
 *      throws EPERM. The lock is released within ~100–500 ms.
 *
 *   2. Office COM convert-to-PDF. After ExportAsFixedFormat returns and the
 *      PowerShell host calls ReleaseComObject + GC.Collect + Quit, Windows
 *      still holds the file handle on the intermediate .pptx / .docx for a
 *      brief window before the kernel drains it. fs.unlinkSync at that
 *      instant throws EPERM, leaving an orphan file the user can't delete
 *      from Explorer (they get the same EPERM because the handle is still
 *      open).
 *
 * Backoff: 100, 250, 500, 1000, 2000 ms = ~3.85 s of total retry budget,
 * which covers both the Dropbox upload window AND the Office handle-release
 * race comfortably. After that we bubble the error so the queue records a
 * proper failure rather than spinning forever.
 */
'use strict';

const fs = require('node:fs/promises');

const RETRY_DELAYS_MS = [100, 250, 500, 1000, 2000];
const RETRYABLE_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'EMFILE', 'ENFILE']);

function isRetryable(err) {
  return !!(err && RETRYABLE_CODES.has(err.code));
}

/**
 * Run an async fn with retry-on-transient-EPERM. The fn is invoked up to
 * 1 + RETRY_DELAYS_MS.length times. The last error is rethrown.
 *
 * Exposed so tests + custom callers can wrap their own fs calls.
 */
async function withRetry(fn, _label) {
  let lastErr;
  for (let i = 0; i <= RETRY_DELAYS_MS.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]));
    }
  }
  throw lastErr;
}

async function readFileWithRetry(p, opts) {
  return withRetry(() => fs.readFile(p, opts), 'readFile ' + p);
}

async function writeFileWithRetry(p, data, opts) {
  return withRetry(() => fs.writeFile(p, data, opts), 'writeFile ' + p);
}

async function unlinkWithRetry(p) {
  return withRetry(() => fs.unlink(p), 'unlink ' + p);
}

module.exports = {
  readFileWithRetry,
  writeFileWithRetry,
  unlinkWithRetry,
  isRetryable,
  withRetry,
  RETRY_DELAYS_MS,
};
