const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const settings = require('./settings');
const logger = require('./logger');
const { resolveOutputPath } = require('./naming');
const WorkerPool = require('./workerPool');
const queueState = require('./queueState');
const { hasVeloxaWatermark } = require('./conflict');
const converter = require('./converter');
const { unlinkWithRetry } = require('./util/fsRetry');

const STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  SKIPPED: 'skipped',
});

const events = new EventEmitter();
events.setMaxListeners(50);

const state = {
  jobs: [],
  activeIds: new Set(),
  paused: false,
  cancelled: false,
  running: false,
  counter: null,
  startedAt: null,
  finishedAt: null,
};

function nextCounter() {
  if (state.counter == null) {
    state.counter = settings.get().startCounter || 1;
  }
  return state.counter++;
}

// ---- Worker pool (true parallelism) ------------------------------------
let pool = null;
function getPool() {
  const cfg = settings.get();
  const desired = cfg.memoryFriendly ? 1 : Math.max(1, Math.min(16, cfg.maxConcurrent || 4));
  if (!pool) {
    pool = new WorkerPool(desired);
    logger.info(`Worker pool started with ${desired} thread(s)`);
  } else if (pool.size !== desired) {
    pool.resize(desired).catch(() => {});
    logger.info(`Worker pool resized to ${desired} thread(s)`);
  }
  return pool;
}

// ---- Crash-safe persistence -------------------------------------------
function persistSnapshot() {
  queueState.save({
    jobs: state.jobs.map((j) => ({
      id: j.id,
      input: j.input,
      output: j.output || null,
      status: j.status,
      // Snapshot the full profile per job so resume works even if the
      // profile was renamed/deleted between sessions.
      profile: j.profile,
      error: j.error || null,
      durationMs: j.durationMs || null,
      bytes: j.bytes || null,
    })),
    counter: state.counter,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
  });
}

function restoreFromDisk() {
  const data = queueState.load();
  if (!data) return null;
  state.jobs = (data.jobs || []).map((j) => ({
    id: j.id || crypto.randomUUID(),
    input: j.input,
    profile: j.profile,
    status: j.status,
    output: j.output,
    error: j.error,
    durationMs: j.durationMs,
    bytes: j.bytes,
    orphans: Array.isArray(j.orphans) ? j.orphans : undefined,
  }));
  state.counter = data.counter ?? null;
  state.startedAt = data.startedAt || null;
  state.finishedAt = data.finishedAt || null;

  // Sweep orphan intermediates from prior runs — files the unlink-with-retry
  // couldn't get rid of last time because AV/Dropbox held the handle past 4 s.
  // On a fresh launch those handles are released, so a single unlink works.
  // Best-effort: silent miss if still locked.
  let swept = 0;
  for (const j of state.jobs) {
    if (!Array.isArray(j.orphans) || j.orphans.length === 0) continue;
    const survivors = [];
    for (const p of j.orphans) {
      try { fs.unlinkSync(p); swept++; }
      catch { survivors.push(p); }
    }
    j.orphans = survivors.length ? survivors : undefined;
  }
  if (swept > 0) logger.info(`Swept ${swept} orphan intermediate file(s) from prior runs.`);

  emitUpdated();
  return {
    pending: counts().pending,
    interrupted: state.jobs.filter((j) => j.status === STATUS.FAILED && /Interrupted/i.test(j.error || '')).length,
    total: state.jobs.length,
  };
}

function publicState() {
  return {
    jobs: state.jobs.map((j) => ({
      id: j.id,
      input: j.input,
      output: j.output || null,
      status: j.status,
      // Defensive: a restored job from a corrupt persistence file might be missing profile.
      profileId: j.profile?.id || null,
      profileName: j.profile?.name || '(unknown)',
      error: j.error || null,
      durationMs: j.durationMs || null,
      bytes: j.bytes || null,
    })),
    paused: state.paused,
    running: state.running,
    counts: counts(),
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
  };
}

function counts() {
  const c = { total: state.jobs.length, pending: 0, running: 0, success: 0, failed: 0, skipped: 0 };
  for (const j of state.jobs) c[j.status] += 1;
  return c;
}

function emitUpdated() {
  events.emit('updated', publicState());
  persistSnapshot();
}

function progressFraction() {
  const total = state.jobs.length || 1;
  const done = state.jobs.filter((j) =>
    j.status === STATUS.SUCCESS || j.status === STATUS.FAILED || j.status === STATUS.SKIPPED
  ).length;
  return done / total;
}

async function runOne(job) {
  job.status = STATUS.RUNNING;
  state.activeIds.add(job.id);
  emitUpdated();
  const start = Date.now();
  try {
    const cfg = settings.get();

    // Conflict detection — if the input already carries a Veloxa watermark
    // and the user has skipAlreadyWatermarked enabled (default true), bail.
    if (cfg.skipAlreadyWatermarked !== false) {
      try {
        if (await hasVeloxaWatermark(job.input)) {
          job.status = STATUS.SKIPPED;
          job.error = 'Already watermarked by Veloxa';
          job.durationMs = Date.now() - start;
          logger.warn(`Skipped (already watermarked): ${path.basename(job.input)}`, { jobId: job.id });
          return;
        }
      } catch {
        // Detection failure is non-fatal — fall through to normal processing.
      }
    }

    const out = resolveOutputPath({
      inputPath: job.input,
      profile: job.profile,
      settings: cfg,
      counter: nextCounter(),
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const { outputPath } = await getPool().exec({
      inputPath: job.input,
      outputPath: out,
      profile: job.profile,
      settings: cfg,
    });

    let finalOutput = outputPath;

    // Optional post-process: convert non-PDF output to PDF via LibreOffice.
    // Triggered when the profile's `convertToPdf` flag is on AND the
    // watermarked file isn't already a PDF.
    if (job.profile.convertToPdf && path.extname(outputPath).toLowerCase() !== '.pdf') {
      const conv = await converter.status();
      if (!conv.available) {
        throw new Error(`Convert-to-PDF requested but ${conv.error}. Install Microsoft Office or LibreOffice, or disable the option in this profile.`);
      }
      // Replace extension with .pdf — keep the same naming-template stem
      // (so {originalname}_WM_001.docx becomes {originalname}_WM_001.pdf).
      const pdfPath = outputPath.replace(/\.[^.]+$/, '.pdf');
      const safe = pdfPath === outputPath ? `${outputPath}.pdf` : pdfPath;
      await converter.convertToPdf(outputPath, safe, {
        preference: cfg.pdfConverter || 'auto',
        quality: job.profile.pdfQuality || 'standard',
      });
      // Delete the intermediate watermarked .docx/.pptx left behind by the
      // PDF conversion step. unlinkWithRetry handles the post-COM file-handle
      // race: Office's PowerShell host calls ReleaseComObject + GC.Collect +
      // Quit but Windows can still hold the kernel handle for a few hundred
      // ms afterwards. Without the retry we'd EPERM, swallow it, and leave
      // an orphan file the user later finds and can't delete (because the
      // handle is *still* technically held by an undead Office worker).
      // 5-step backoff gives the OS up to ~3.85 s to release.
      try {
        await unlinkWithRetry(outputPath);
        logger.debug(`Deleted intermediate ${path.basename(outputPath)} after PDF conversion`, { jobId: job.id });
      } catch (unlinkErr) {
        // Last-ditch fallback: queue the intermediate for deletion on next
        // app launch so the user isn't permanently stuck with an orphan.
        // Most cleanups happen via the retry above; this branch only fires
        // when an antivirus / Dropbox / OneDrive holds the file past 4 s.
        logger.warn(
          `Could not delete intermediate ${path.basename(outputPath)} ` +
          `(${unlinkErr.code || 'EUNKNOWN'}). It will be cleaned up next launch.`,
          { jobId: job.id, intermediate: outputPath }
        );
        if (!job.orphans) job.orphans = [];
        job.orphans.push(outputPath);
      }
      finalOutput = safe;
      logger.info(`Converted to PDF (${conv.active}): ${path.basename(safe)}`, { jobId: job.id });
    }

    job.output = finalOutput;
    job.status = STATUS.SUCCESS;
    job.durationMs = Date.now() - start;
    try { job.bytes = fs.statSync(finalOutput).size; } catch {}
    logger.success(`Watermarked ${path.basename(job.input)} → ${path.basename(finalOutput)}`, {
      jobId: job.id,
      input: job.input,
      output: finalOutput,
      ms: job.durationMs,
    });
  } catch (err) {
    job.status = STATUS.FAILED;
    job.error = err?.message || String(err);
    job.durationMs = Date.now() - start;
    logger.error(`Failed: ${path.basename(job.input)} — ${job.error}`, {
      jobId: job.id, input: job.input, error: job.error,
    });
  } finally {
    state.activeIds.delete(job.id);
    events.emit('progress', { fraction: progressFraction(), counts: counts() });
    emitUpdated();
  }
}

async function loop() {
  if (state.running) return;
  state.running = true;
  state.cancelled = false;
  // Always reset the run timer — pause/resume don't re-enter loop(), so the
  // only path here is a fresh Process click. Reusing a stale startedAt from a
  // crashed-then-restored previous run would yield bogus durationMs at done.
  state.startedAt = Date.now();
  state.finishedAt = null;
  emitUpdated();

  const cfg = settings.get();
  const baseConcurrency = Math.max(1, Math.min(16, cfg.maxConcurrent || 4));
  const concurrency = cfg.memoryFriendly ? 1 : baseConcurrency;

  while (!state.cancelled) {
    if (state.paused) { await sleep(120); continue; }
    const next = state.jobs.find((j) => j.status === STATUS.PENDING);
    if (!next && state.activeIds.size === 0) break;
    if (!next) { await sleep(60); continue; }
    if (state.activeIds.size >= concurrency) { await sleep(40); continue; }
    runOne(next).catch(() => {});
  }

  // Drain
  while (state.activeIds.size > 0) await sleep(60);

  state.running = false;
  state.finishedAt = Date.now();
  const summary = counts();
  events.emit('done', { ...summary, durationMs: state.finishedAt - state.startedAt });
  logger.info(`Run complete — ${summary.success} ok, ${summary.failed} failed, ${summary.skipped} skipped`, summary);
  emitUpdated();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function enqueue(files, profile) {
  // If the queue is currently idle (no pending or running jobs), this
  // enqueue marks the start of a fresh batch — restart the {counter} naming
  // token so users get predictable 001..N numbering per click of PROCESS.
  // If the queue is still active (paused or running), the new files join the
  // existing batch and continue counting from where it left off.
  const hasActiveWork = state.jobs.some(
    (j) => j.status === STATUS.PENDING || j.status === STATUS.RUNNING,
  );
  if (!hasActiveWork) {
    state.counter = null;
  }

  const added = [];
  for (const f of files) {
    state.jobs.push({
      id: crypto.randomUUID(),
      input: f,
      profile,
      status: STATUS.PENDING,
    });
    added.push(f);
  }
  logger.info(`Enqueued ${added.length} file(s) with profile "${profile.name}"`
    + (hasActiveWork ? ' (continuing current batch)' : ' (new batch — counter restarts)'));

  // Track this profile in the "recently used" list (most-recent first, max 5)
  if (profile && profile.id) {
    const cfg = settings.get();
    const recents = (cfg.recentProfileIds || []).filter((id) => id !== profile.id);
    recents.unshift(profile.id);
    settings.set({ recentProfileIds: recents.slice(0, 5) });
  }

  emitUpdated();
  return { added: added.length };
}

function start() {
  state.paused = false;
  if (!state.running) loop().catch((e) => logger.error(`Queue loop crashed: ${e.message}`));
  return publicState();
}
function pause() { state.paused = true; emitUpdated(); return publicState(); }
function resume() { state.paused = false; emitUpdated(); return publicState(); }
function cancel() {
  state.cancelled = true;
  state.paused = false;
  state.jobs.forEach((j) => { if (j.status === STATUS.PENDING) j.status = STATUS.SKIPPED; });
  emitUpdated();
  return publicState();
}
function retryFailed() {
  state.jobs.forEach((j) => { if (j.status === STATUS.FAILED) { j.status = STATUS.PENDING; j.error = null; }});
  emitUpdated();
  if (!state.running) start();
  return publicState();
}
function clearCompleted() {
  state.jobs = state.jobs.filter((j) => j.status !== STATUS.SUCCESS);
  emitUpdated();
  return publicState();
}
// Drop every failed-status job from the list. Common after a Dropbox/AV hiccup:
// the user fixed the underlying issue, retried, and wants the failed shadows gone.
function clearFailed() {
  state.jobs = state.jobs.filter((j) => j.status !== STATUS.FAILED);
  emitUpdated();
  return publicState();
}
// Per-row delete. Refuses to remove a running job — that would leave a worker
// orphaned with no row to write its result back into. Cancel-then-remove is
// the correct flow if you really want to nuke a running job.
function removeJob(jobId) {
  const idx = state.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) return publicState();
  if (state.jobs[idx].status === STATUS.RUNNING) {
    return publicState();
  }
  state.jobs.splice(idx, 1);
  emitUpdated();
  return publicState();
}
function clearAll() {
  if (state.running) cancel();
  state.jobs = [];
  state.startedAt = null;
  state.finishedAt = null;
  state.counter = null;
  queueState.clear();
  emitUpdated();
  return publicState();
}
function status() { return publicState(); }

async function destroyPool() {
  if (pool) {
    await pool.destroy();
    pool = null;
  }
}

module.exports = {
  events,
  STATUS,
  enqueue,
  start,
  pause,
  resume,
  cancel,
  retryFailed,
  clearCompleted,
  clearFailed,
  removeJob,
  clearAll,
  status,
  restoreFromDisk,
  destroyPool,
  poolStats: () => pool ? pool.stats() : null,
};
