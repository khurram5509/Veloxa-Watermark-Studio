/**
 * Per-machine system probe — CPU cores, GPU(s), total memory.
 *
 * Why this exists: users span a wide range of hardware (4 GB low-resource
 * laptops up to 32 GB workstations with discrete GPUs). The engine's
 * actual hot path is CPU-bound (pdf-lib / pizzip / XML manipulation /
 * external Office COM calls) so a GPU doesn't accelerate the watermark
 * pipeline directly. But:
 *
 *   1. The worker pool can scale to physical cores — fewer on tiny VMs,
 *      more on workstations — for a meaningful concurrency win.
 *   2. Surfacing what the engine sees ("8 cores · NVIDIA RTX 3060 · 16 GB")
 *      in Settings gives users transparency about how their machine is
 *      being used.
 *   3. The Settings panel can honestly explain "GPU detected but the
 *      pipeline is CPU-bound" instead of pretending to use it.
 *
 * Per-call cost: ~50 ms for cores + memory (synchronous os.* reads),
 * ~200 ms for GPU on Windows (spawning wmic), ~500 ms on macOS
 * (system_profiler). We cache the result for the process lifetime —
 * hardware doesn't change at runtime.
 *
 * All probes are best-effort. Failures return null fields, never throw.
 */
'use strict';

const os = require('node:os');
const { spawn } = require('node:child_process');

let _cache = null;

/**
 * Run a child process, capture stdout, return it. Timeout-bounded so a
 * hung wmic / system_profiler can't stall our Settings load.
 */
function runCmd(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const child = spawn(cmd, args, { windowsHide: true });
    const killer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      resolve(''); // timeout → empty stdout, caller falls back
    }, timeoutMs);
    child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve('');
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      resolve(out);
    });
  });
}

/**
 * Enumerate GPUs on this host.
 *
 * Windows: wmic — ships in every Windows 10/11 by default. Pipes the
 *   list of video adapter names. Filter out the Windows "Microsoft Basic
 *   Display Adapter" RDP / safe-mode fallback because it doesn't represent
 *   real hardware.
 * macOS:   system_profiler SPDisplaysDataType. Slow (~500 ms cold) but
 *   present on every macOS install.
 * Linux:   lspci -mm | grep VGA — pulls discrete + integrated.
 *
 * Returns: array of { name, vendor } objects, possibly empty.
 */
async function probeGpus() {
  if (process.platform === 'win32') {
    // /VALUE format avoids the column-truncation that the default tabular
    // output does on long GPU names like "NVIDIA GeForce RTX 3060 Ti".
    const out = await runCmd('wmic', ['path', 'win32_VideoController', 'get', 'name', '/VALUE'], 5000);
    if (!out) return [];
    const names = [];
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s*Name=(.+?)\s*$/i);
      if (m && m[1]) names.push(m[1]);
    }
    return names
      .filter((n) => !/Microsoft Basic Display Adapter|Microsoft Remote Display Adapter/i.test(n))
      .map((name) => ({ name, vendor: vendorFromName(name) }));
  }

  if (process.platform === 'darwin') {
    // -xml would be more robust but parsing here keeps the surface small.
    const out = await runCmd('system_profiler', ['SPDisplaysDataType'], 8000);
    if (!out) return [];
    const names = [];
    for (const block of out.split(/\n\s*\n/)) {
      const m = block.match(/^\s*Chipset Model:\s*(.+?)\s*$/m);
      if (m && m[1]) names.push(m[1]);
    }
    return names.map((name) => ({ name, vendor: vendorFromName(name) }));
  }

  if (process.platform === 'linux') {
    // -mm machine-readable; columns separated by spaces in field-quoted form
    const out = await runCmd('lspci', ['-mm'], 5000);
    if (!out) return [];
    const names = [];
    for (const line of out.split(/\r?\n/)) {
      // Filter VGA / 3D / Display controllers
      if (!/VGA|3D|Display/i.test(line)) continue;
      // Field 3 ("vendor") + field 4 ("device") usually compose a useful name
      const parts = line.match(/"([^"]*)"/g);
      if (parts && parts.length >= 4) {
        const vendor = parts[2].replace(/"/g, '');
        const device = parts[3].replace(/"/g, '');
        names.push({ name: `${vendor} ${device}`.trim(), vendor: vendorFromName(vendor) });
      }
    }
    return names;
  }

  return [];
}

function vendorFromName(name) {
  if (!name) return 'unknown';
  if (/nvidia|geforce|quadro|tesla|gtx|rtx/i.test(name)) return 'NVIDIA';
  if (/amd|radeon|firepro/i.test(name)) return 'AMD';
  if (/intel|iris|uhd graphics|hd graphics/i.test(name)) return 'Intel';
  if (/apple m\d|m\d gpu/i.test(name)) return 'Apple';
  return 'unknown';
}

/**
 * Summarize what this host can throw at the watermark queue. Cached after
 * the first call (hardware is static). Pass `{ refresh: true }` to force
 * re-probe — useful if a test wants to mock & re-read.
 */
async function getSystemInfo({ refresh = false } = {}) {
  if (_cache && !refresh) return _cache;

  const cpus = os.cpus() || [];
  const cpuCount = cpus.length || 1;
  const cpuModel = cpus[0] && cpus[0].model ? cpus[0].model.trim().replace(/\s+/g, ' ') : 'unknown';

  // os.totalmem returns bytes; round to GB at 2dp for display, keep raw
  // bytes for any code that wants to threshold (e.g. "fewer workers on
  // 4 GB systems").
  const totalMemBytes = os.totalmem();
  const totalMemGB = Math.round((totalMemBytes / (1024 ** 3)) * 10) / 10;

  // GPU probe is the expensive bit; await but tolerate the timeout if the
  // tool isn't present or the host is misconfigured.
  let gpus = [];
  try { gpus = await probeGpus(); } catch { /* empty */ }

  _cache = {
    platform: process.platform,
    arch: process.arch,
    cpuCount,
    cpuModel,
    totalMemBytes,
    totalMemGB,
    gpus,
    /**
     * Worker-pool recommendation. The actual workerPool already uses
     * `Math.max(1, cpuCount - 1)` as its default size; this exposes that
     * same number so the Settings panel can show "Using N of M cores"
     * without re-implementing the math.
     */
    recommendedWorkers: Math.max(1, cpuCount - 1),
    /**
     * Whether the engine uses the GPU. Currently `false` everywhere — the
     * pipeline is XML / PDF-lib / external-Office and none of those are
     * GPU-accelerated. Exposed as a field rather than left implicit so the
     * Settings panel can render an honest "GPU detected but not used"
     * explanation rather than implying acceleration that doesn't happen.
     */
    gpuUsedByEngine: false,
  };
  return _cache;
}

module.exports = { getSystemInfo, probeGpus, vendorFromName };
