/**
 * Crash-safe queue persistence.
 *
 * Snapshots the in-memory queue state (jobs + counter) to a JSON file on every
 * material change, debounced. On launch, loads the file; any "running" jobs
 * are reclassified as "failed" (since the previous run was killed mid-flight),
 * "pending" jobs stay pending, and "success" jobs stay as a history.
 *
 * The file is cleared on a clean app shutdown.
 */
const fs = require('node:fs');
const path = require('node:path');
const { dataDir } = require('./paths');

function statePath() { return path.join(dataDir(), 'queue.json'); }

let writeTimer = null;
let lastWritten = '';

function load() {
  try {
    const raw = fs.readFileSync(statePath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.jobs)) return null;
    // Reclassify in-flight jobs from the previous run as failed-interrupted.
    for (const j of data.jobs) {
      if (j.status === 'running') {
        j.status = 'failed';
        j.error = 'Interrupted (app exit before completion)';
      }
    }
    return data;
  } catch {
    return null;
  }
}

function save(snapshot) {
  // Debounce 200ms to coalesce burst updates from progress events.
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      const json = JSON.stringify(snapshot);
      if (json === lastWritten) return;
      fs.writeFileSync(statePath(), json, 'utf8');
      lastWritten = json;
    } catch {
      /* persistence is best-effort */
    }
  }, 200);
}

function flush(snapshot) {
  // Synchronous variant for clean-shutdown handlers.
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  try {
    fs.writeFileSync(statePath(), JSON.stringify(snapshot), 'utf8');
  } catch {}
}

function clear() {
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  try { fs.unlinkSync(statePath()); } catch {}
  lastWritten = '';
}

function exists() {
  try { return fs.statSync(statePath()).isFile(); } catch { return false; }
}

module.exports = { load, save, flush, clear, exists, statePath };
