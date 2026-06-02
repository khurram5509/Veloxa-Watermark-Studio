#!/usr/bin/env node
/**
 * Veloxa Watermark Studio — HTTP backend.
 *
 * Local-only REST API that exposes the same engine the desktop app uses, so
 * scripts / other apps / CI can drive watermarking without the GUI. Binds to
 * 127.0.0.1 by default so it's not exposed externally; override with
 * VELOXA_HOST and VELOXA_PORT env vars.
 *
 * Run with:   node server/index.js   (or `npm run server`)
 * Inspect:    GET http://127.0.0.1:4719/api/health
 */
const http = require('node:http');
const routes = require('./routes');

const VERSION = require('../package.json').version;
const PORT = parseInt(process.env.VELOXA_PORT, 10) || 4719;
const HOST = process.env.VELOXA_HOST || '127.0.0.1';

const server = http.createServer(async (req, res) => {
  // CORS — local origins only for safety; relax via env if needed
  const allowedOrigin = process.env.VELOXA_CORS || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const t0 = Date.now();
  try {
    await routes.handle(req, res);
  } catch (err) {
    if (!res.headersSent) {
      const status = err && err.status ? err.status : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
    }
    if (!err.status || err.status >= 500) {
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.url} →`, err && err.stack ? err.stack : err);
    }
  } finally {
    const ms = Date.now() - t0;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
  }
});

// Warm the converter cache BEFORE listen() so /api/validate gives a correct
// answer for profiles that have convertToPdf enabled. Office COM probes can
// take 30-60s on cold boot; serving requests before they finish would mean
// validation incorrectly reports "no converter detected" even when one
// exists. We pay the startup cost up-front instead of giving wrong answers.
(async () => {
  const profiles = require('../engine/profiles');
  const converter = require('../engine/converter');
  process.stdout.write('Probing PDF converters (may take ~30-60s on cold boot)...\n');
  const conv = await converter.status().catch(() => ({ available: false, error: 'probe failed' }));

  server.listen(PORT, HOST, () => {
    console.log('');
    console.log('Veloxa Watermark Studio · backend');
    console.log(`  version  : v${VERSION}`);
    console.log(`  listening: http://${HOST}:${PORT}`);
    console.log(`  profiles : ${profiles.list().length}`);
    if (conv.available) {
      console.log(`  converter: ${conv.backends.join(' + ')}`);
    } else {
      console.log(`  converter: none (${conv.error || 'no Office or LibreOffice'})`);
    }
    console.log('');
  console.log('  Endpoints:');
  console.log('    GET    /api/health');
  console.log('    GET    /api/version');
  console.log('    GET    /api/profiles');
  console.log('    POST   /api/profiles');
  console.log('    GET    /api/profiles/:id');
  console.log('    PUT    /api/profiles/:id');
  console.log('    DELETE /api/profiles/:id');
  console.log('    GET    /api/settings');
  console.log('    PATCH  /api/settings');
  console.log('    POST   /api/scan          {path}        → list supported files');
  console.log('    POST   /api/watermark     {input,profile|profileId,output?}');
  console.log('    POST   /api/watermark/batch {inputs[]|folder, profile|profileId}');
  console.log('    GET    /api/queue         → live queue state');
  console.log('');
  });
})().catch((err) => {
  console.error('Failed to start backend:', err);
  process.exit(1);
});

// Clean shutdown on Ctrl+C — terminate worker pool first
function shutdown(sig) {
  console.log(`\nReceived ${sig} — shutting down...`);
  const queue = require('../engine/queue');
  queue.destroyPool().finally(() => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
