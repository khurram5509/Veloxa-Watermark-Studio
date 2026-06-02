const path = require('node:path');
const fs = require('node:fs');

function pad(n, width) {
  const s = String(n);
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
}

function timeStr() {
  const d = new Date();
  return `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
}

function applyTemplate(template, ctx) {
  return template
    .replace(/\{originalname\}/g, ctx.originalname)
    .replace(/\{counter\}/g, pad(ctx.counter, ctx.padding || 3))
    .replace(/\{date\}/g, todayStr())
    .replace(/\{time\}/g, timeStr())
    .replace(/\{profile\}/g, sanitize(ctx.profileName))
    .replace(/\{ext\}/g, ctx.ext.replace('.', ''));
}

function sanitize(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim();
}

function resolveOutputPath({ inputPath, profile, settings, counter }) {
  const dir =
    settings.outputMode === 'custom' && settings.customOutputDir
      ? settings.customOutputDir
      : path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const originalname = path.basename(inputPath, ext);
  const template = profile.namingTemplate || settings.namingTemplate || '{originalname}_WM_{counter}';
  const baseName = applyTemplate(template, {
    originalname,
    counter,
    padding: settings.counterPadding || 3,
    profileName: profile.name,
    ext,
  });

  let candidate = path.join(dir, sanitize(baseName) + ext);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${sanitize(baseName)}_${n}${ext}`);
    n += 1;
  }
  return candidate;
}

module.exports = { applyTemplate, resolveOutputPath, sanitize };
