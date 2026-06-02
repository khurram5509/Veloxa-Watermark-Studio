/**
 * Watermark worker — runs in a Node worker_thread spawned by the pool.
 * Receives a job message, dispatches to the format-appropriate processor,
 * posts back { jobId, result } or { jobId, error }.
 *
 * Workers have full Node.js access. They DO NOT load the Electron app object,
 * so this file must not transitively require engine/paths.js (which uses
 * electron.app.getPath).
 */
const { parentPort } = require('node:worker_threads');
const processors = require('./processors');

if (!parentPort) {
  throw new Error('engine/worker.js must be spawned via worker_threads.');
}

parentPort.on('message', async (msg) => {
  const { jobId } = msg || {};
  try {
    const result = await processors.process({
      inputPath: msg.inputPath,
      outputPath: msg.outputPath,
      profile: msg.profile,
      settings: msg.settings,
    });
    parentPort.postMessage({ jobId, result });
  } catch (err) {
    parentPort.postMessage({
      jobId,
      error: (err && err.message) || String(err),
      stack: err && err.stack,
    });
  }
});
