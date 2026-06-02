const url = require('node:url');
const fs = require('node:fs');
const path = require('node:path');

const profiles = require('../engine/profiles');
const settings = require('../engine/settings');
const queue = require('../engine/queue');
const processors = require('../engine/processors');
const { resolveOutputPath } = require('../engine/naming');
const { scanPaths } = require('../engine/scanner');
const { validateProfile } = require('../engine/validation');
const converter = require('../engine/converter');
const updater = require('../engine/updater');
const pkg = require('../package.json');
const VERSION = pkg.version;

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function readBody(req, maxBytes = 10 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > maxBytes) {
        reject(new HttpError(413, `Request body too large (>${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const body = await readBody(req);
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw new HttpError(400, 'Invalid JSON body'); }
}

function send(res, status, body, contentType = 'application/json') {
  if (typeof body === 'object' && contentType === 'application/json') body = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function resolveProfile(body) {
  if (body.profile && typeof body.profile === 'object') return body.profile;
  if (body.profileId) {
    const p = profiles.get(body.profileId);
    if (!p) throw new HttpError(404, `Profile not found: ${body.profileId}`);
    return p;
  }
  const def = profiles.getDefault();
  if (def) return def;
  throw new HttpError(400, 'profile or profileId required (and no default profile set)');
}

async function handle(req, res) {
  const u = url.parse(req.url, true);
  const pathname = u.pathname;
  const method = req.method;

  // -------- Health / version --------
  if (pathname === '/api/health' && method === 'GET') {
    // converter.status() reads cached value (warmed at server boot) — fast.
    const conv = await converter.status();
    return send(res, 200, {
      ok: true,
      version: VERSION,
      profiles: profiles.list().length,
      pool: queue.poolStats(),
      converter: {
        available: conv.available,
        active: conv.active,
        backends: conv.backends,
        msoffice: conv.msoffice,
        libreoffice: conv.libreoffice,
      },
    });
  }
  if (pathname === '/api/converter' && method === 'GET') {
    const conv = await converter.status(u.query && u.query.refresh === '1');
    return send(res, 200, conv);
  }
  if (pathname === '/api/version' && method === 'GET') {
    return send(res, 200, { version: VERSION });
  }

  // -------- Profiles --------
  if (pathname === '/api/profiles' && method === 'GET') {
    return send(res, 200, profiles.list());
  }
  if (pathname === '/api/profiles' && method === 'POST') {
    const body = await readJson(req);
    return send(res, 200, profiles.save(body));
  }
  const m = pathname.match(/^\/api\/profiles\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') {
      const p = profiles.get(id);
      if (!p) throw new HttpError(404, 'Profile not found');
      return send(res, 200, p);
    }
    if (method === 'PUT') {
      const body = await readJson(req);
      return send(res, 200, profiles.save({ ...body, id }));
    }
    if (method === 'DELETE') {
      profiles.remove(id);
      return send(res, 200, { ok: true, id });
    }
  }

  // -------- Settings --------
  if (pathname === '/api/settings' && method === 'GET') {
    return send(res, 200, settings.get());
  }
  if (pathname === '/api/settings' && method === 'PATCH') {
    const body = await readJson(req);
    return send(res, 200, settings.set(body));
  }

  // -------- Scan a folder --------
  if (pathname === '/api/scan' && method === 'POST') {
    const body = await readJson(req);
    if (!body.path && !Array.isArray(body.paths)) {
      throw new HttpError(400, '`path` or `paths` (array) required');
    }
    const inputs = Array.isArray(body.paths) ? body.paths : [body.path];
    const result = await scanPaths(inputs);
    return send(res, 200, result);
  }

  // -------- Validate a profile --------
  if (pathname === '/api/validate' && method === 'POST') {
    const body = await readJson(req);
    const profile = resolveProfile(body);
    return send(res, 200, validateProfile(profile));
  }

  // -------- Single watermark --------
  if (pathname === '/api/watermark' && method === 'POST') {
    const body = await readJson(req);
    if (!body.input) throw new HttpError(400, '`input` (file path) required');
    if (!fs.existsSync(body.input)) throw new HttpError(404, `Input file not found: ${body.input}`);

    const profile = resolveProfile(body);
    const validation = validateProfile(profile);
    if (!validation.ok) throw new HttpError(400, `Profile invalid: ${validation.errors.join('; ')}`);

    const cfg = settings.get();
    const out = body.output || resolveOutputPath({
      inputPath: body.input,
      profile,
      settings: cfg,
      counter: 1,
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const t0 = Date.now();
    const result = await processors.process({
      inputPath: body.input,
      outputPath: out,
      profile,
      settings: cfg,
    });
    return send(res, 200, {
      ok: true,
      output: result.outputPath,
      durationMs: Date.now() - t0,
      bytes: fs.statSync(result.outputPath).size,
    });
  }

  // -------- Batch watermark via the queue --------
  if (pathname === '/api/watermark/batch' && method === 'POST') {
    const body = await readJson(req);
    let inputs = Array.isArray(body.inputs) ? body.inputs : null;
    if (!inputs && body.folder) {
      const scan = await scanPaths([body.folder]);
      inputs = scan.files;
    }
    if (!inputs || !inputs.length) {
      throw new HttpError(400, '`inputs` (array) or `folder` required');
    }
    const profile = resolveProfile(body);
    const validation = validateProfile(profile);
    if (!validation.ok) throw new HttpError(400, `Profile invalid: ${validation.errors.join('; ')}`);

    queue.enqueue(inputs, profile);
    queue.start();

    // Wait for completion or timeout (configurable, default 10 min)
    const timeoutMs = Number(body.timeoutMs) || 600_000;
    const done = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), timeoutMs);
      queue.events.once('done', (summary) => {
        clearTimeout(timer);
        resolve(summary);
      });
    });

    const status = queue.status();
    return send(res, 200, {
      ok: done !== 'timeout',
      timedOut: done === 'timeout',
      counts: status.counts,
      jobs: status.jobs.map((j) => ({
        input: j.input,
        output: j.output,
        status: j.status,
        durationMs: j.durationMs,
        bytes: j.bytes,
        error: j.error,
      })),
    });
  }

  // -------- Auto-updater (v2.5.0) --------
  if (pathname === '/api/update/check' && method === 'GET') {
    const repo = (pkg.veloxa && pkg.veloxa.updateRepo) || 'veloxa-app/watermark-studio';
    const assetPattern = (pkg.veloxa && pkg.veloxa.updateAssetPattern) || 'VeloxaWatermarkStudio-Setup-{version}.exe';
    try {
      const r = await updater.check({
        currentVersion: VERSION,
        repo,
        assetPattern,
        force: u.query && u.query.force === '1',
        settingsAdapter: { get: () => settings.get(), set: (p) => settings.set(p) },
      });
      return send(res, 200, r);
    } catch (err) {
      return send(res, 502, { ok: false, error: err.message, current: VERSION });
    }
  }

  // -------- Live queue state --------
  if (pathname === '/api/queue' && method === 'GET') {
    return send(res, 200, queue.status());
  }
  if (pathname === '/api/queue/clear' && method === 'POST') {
    queue.clearAll();
    return send(res, 200, { ok: true });
  }

  // Default 404
  send(res, 404, { ok: false, error: `Not found: ${method} ${pathname}` });
}

module.exports = { handle, HttpError };
