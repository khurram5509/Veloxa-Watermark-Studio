#!/usr/bin/env node
/**
 * Generate build/icon.ico + build/icon.png from scratch — no graphics deps.
 *
 * Designs a rounded-square Veloxa-blue badge with a stylized white "V" mark
 * across the center, anti-aliased, then packs PNG-format frames at 16/32/48/
 * 64/128/256 into a Windows .ico container. The 256×256 PNG also gets written
 * separately for use as the Electron tray icon (electron's Tray accepts PNG).
 *
 * Run with: node scripts/generate-icon.js
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.resolve(__dirname, '..', 'build');
const ICO_PATH = path.join(OUT_DIR, 'icon.ico');
const PNG_PATH = path.join(OUT_DIR, 'icon.png');

const SIZES = [16, 32, 48, 64, 128, 256];

// Veloxa palette — pulled from src/index.css token names.
const HEX_TOP_LEFT     = [0x1F, 0x3D, 0xF5]; // veloxa-600
const HEX_BOTTOM_RIGHT = [0x5E, 0x87, 0xFF]; // veloxa-400
const WHITE = [0xFF, 0xFF, 0xFF];

// ---------- pixel-math helpers ----------------------------------------------

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// Smoothstep from edge0 → edge1 around `x` (used for anti-aliased coverage).
function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

// Signed distance from (x,y) to the nearest point of a rounded-rect outline.
// Negative inside, positive outside. Used to soft-feather the badge edge.
function sdfRoundedRect(x, y, size, r) {
  const cx = size / 2;
  const cy = size / 2;
  const half = size / 2 - 0.5; // -0.5 so the geometric edge sits between pixels
  const dx = Math.abs(x - cx) - (half - r);
  const dy = Math.abs(y - cy) - (half - r);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  return Math.sqrt(outsideX * outsideX + outsideY * outsideY) +
         Math.min(Math.max(dx, dy), 0) - r;
}

// Closest distance from point p to segment ab — used to thick-stroke the "V".
function distancePointSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) t = clamp01((apx * abx + apy * aby) / lenSq);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
// Alpha-composite `src` (rgba 0..255) over `dst` (rgba 0..255) → in-place mutation.
function compositeOver(dst, di, src, sr, sg, sb, sa) {
  const sA = sa / 255;
  const dA = dst[di + 3] / 255;
  const outA = sA + dA * (1 - sA);
  if (outA === 0) { dst[di] = dst[di+1] = dst[di+2] = dst[di+3] = 0; return; }
  dst[di]   = Math.round((sr * sA + dst[di]   * dA * (1 - sA)) / outA);
  dst[di+1] = Math.round((sg * sA + dst[di+1] * dA * (1 - sA)) / outA);
  dst[di+2] = Math.round((sb * sA + dst[di+2] * dA * (1 - sA)) / outA);
  dst[di+3] = Math.round(outA * 255);
}

// ---------- render a single icon at a given size ----------------------------

function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4); // RGBA
  const radius = Math.max(2, Math.round(size * 0.18));

  // Stroke endpoints for the "V" — calibrated so it sits visually centered
  // and balanced even at tiny sizes. The 4-pixel breathing room on top/bottom
  // keeps the glyph readable when downscaled to 16×16.
  const vMargin = Math.max(2, Math.round(size * 0.18));
  const vTopY = vMargin + size * 0.08;
  const vBotY = size - vMargin - size * 0.05;
  const vLeftX  = vMargin + size * 0.05;
  const vCenterX = size / 2;
  const vRightX  = size - vMargin - size * 0.05;
  const strokeHalfW = Math.max(1.0, size * 0.07); // half thickness

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // ── 1. Rounded-rect badge with smooth-stepped edge (1 px feather) ──
      const sdf = sdfRoundedRect(x + 0.5, y + 0.5, size, radius);
      const badgeAlpha = 1 - smoothstep(-0.5, 0.5, sdf);
      if (badgeAlpha <= 0.001) continue;

      // Diagonal gradient top-left → bottom-right
      const t = (x + y) / (2 * (size - 1));
      const [r, g, b] = lerp3(HEX_TOP_LEFT, HEX_BOTTOM_RIGHT, t);
      px[idx]     = Math.round(r);
      px[idx + 1] = Math.round(g);
      px[idx + 2] = Math.round(b);
      px[idx + 3] = Math.round(badgeAlpha * 255);

      // ── 2. White "V" mark — two thick strokes meeting at the bottom ──
      const cx = x + 0.5;
      const cy = y + 0.5;
      const dLeft  = distancePointSegment(cx, cy, vLeftX,  vTopY, vCenterX, vBotY);
      const dRight = distancePointSegment(cx, cy, vCenterX, vBotY, vRightX, vTopY);
      const dV = Math.min(dLeft, dRight);
      const vAlpha = (1 - smoothstep(strokeHalfW - 0.6, strokeHalfW + 0.6, dV)) * badgeAlpha;
      if (vAlpha > 0.001) {
        compositeOver(px, idx, px, WHITE[0], WHITE[1], WHITE[2], Math.round(vAlpha * 255));
      }
    }
  }
  return px;
}

// ---------- PNG encoder (RGBA, no deps) -------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  const crcIn = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  out.writeUInt32BE(crc32(crcIn), 8 + data.length);
  return out;
}
function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // 10..12 = compression / filter / interlace, all 0
  // Per-scanline filter byte 0 + RGBA pixels
  const scan = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    scan[row] = 0;
    rgba.copy(scan, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(scan, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- ICO container ---------------------------------------------------

function encodeIco(frames) {
  // ICONDIR (6 bytes) + N×ICONDIRENTRY (16 bytes) + image data
  const headerLen = 6 + frames.length * 16;
  let offset = headerLen;
  const dirEntries = frames.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;        // width (0 → 256)
    entry[1] = size === 256 ? 0 : size;        // height
    entry[2] = 0;                              // color count (0 for 32-bit)
    entry[3] = 0;                              // reserved
    entry.writeUInt16LE(1, 4);                 // color planes
    entry.writeUInt16LE(32, 6);                // bits per pixel
    entry.writeUInt32LE(data.length, 8);       // size in bytes
    entry.writeUInt32LE(offset, 12);           // offset
    offset += data.length;
    return entry;
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(frames.length, 4); // count
  return Buffer.concat([header, ...dirEntries, ...frames.map(f => f.data)]);
}

// ---------- main ------------------------------------------------------------

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('Generating Veloxa icon set…');
const frames = SIZES.map((size) => {
  const rgba = renderIcon(size);
  const data = encodePng(rgba, size);
  console.log(`  ${size}×${size}  → ${(data.length / 1024).toFixed(1)} KB`);
  return { size, data };
});

fs.writeFileSync(ICO_PATH, encodeIco(frames));
console.log(`Wrote ${ICO_PATH} (${(fs.statSync(ICO_PATH).size / 1024).toFixed(1)} KB)`);

// Also drop a 256-px PNG for the Electron tray + any non-Windows targets.
const png256 = frames.find(f => f.size === 256).data;
fs.writeFileSync(PNG_PATH, png256);
console.log(`Wrote ${PNG_PATH} (${(fs.statSync(PNG_PATH).size / 1024).toFixed(1)} KB)`);
