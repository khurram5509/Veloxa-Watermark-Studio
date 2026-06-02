const fs = require('node:fs');
const converter = require('./converter');

/**
 * Validate a profile object before it's used to process a batch.
 * Returns { ok, errors, warnings } so the renderer can surface a friendly
 * dialog and the backend can return a 400.
 */
function validateProfile(profile) {
  const errors = [];
  const warnings = [];
  if (!profile || typeof profile !== 'object') {
    return { ok: false, errors: ['No profile provided'], warnings };
  }
  if (!profile.name || !String(profile.name).trim()) {
    errors.push('Profile is missing a name');
  }

  const usesText = profile.type === 'text' || profile.type === 'combined';
  const usesLogo = profile.type === 'image' || profile.type === 'combined';

  if (usesText) {
    if (!profile.text || !String(profile.text).trim()) {
      errors.push('Profile uses text but no watermark text is set');
    } else if (String(profile.text).length > 10000) {
      // A real watermark is "CONFIDENTIAL" or "Draft v3" — not 5 MB of text.
      // Cap at 10K chars so a misbehaving script (or a buggy test that
      // accidentally targets the real user data dir) can't bloat
      // profiles.json and make startup hang while the renderer parses it.
      errors.push(`Watermark text is too long (${profile.text.length} chars, max 10000)`);
    }
  }

  if (usesLogo) {
    if (!profile.logoPath) {
      errors.push('Profile uses a logo but no logo path is set');
    } else if (!fs.existsSync(profile.logoPath)) {
      errors.push(`Logo file not found on disk: ${profile.logoPath}`);
    } else {
      // Warn if the file isn't a recognized format
      if (!/\.(png|jpe?g)$/i.test(profile.logoPath)) {
        warnings.push('Logo file is not PNG/JPG — may not render correctly');
      }
    }
  }

  if (profile.pages === 'custom') {
    const tokens = String(profile.customPages || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (tokens.length === 0) {
      errors.push('Custom page range is empty (e.g. "1-3, 5, 8-10")');
    }
    for (const t of tokens) {
      if (!/^\d+(-\d+)?$/.test(t)) {
        errors.push(`Invalid page range token: "${t}" (expected "1" or "1-5")`);
      } else if (t.includes('-')) {
        const [a, b] = t.split('-').map(Number);
        if (a > b) errors.push(`Inverted page range: "${t}"`);
      }
    }
  }

  // Numeric sanity
  if (profile.opacity != null && (profile.opacity < 0 || profile.opacity > 1)) {
    warnings.push(`Opacity ${profile.opacity} clamped to 0..1`);
  }
  if (profile.fontSize != null && profile.fontSize <= 0) {
    errors.push(`Font size must be > 0 (got ${profile.fontSize})`);
  }

  // Convert-to-PDF requires either Microsoft Office or LibreOffice.
  // We use the cached probe — if status() hasn't been called yet, isAvailable() is false.
  if (profile.convertToPdf && !converter.isAvailable()) {
    warnings.push('Convert-to-PDF is enabled but no PDF converter was detected. Install Microsoft Office (Word/PowerPoint) or LibreOffice — or disable the option in this profile.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { validateProfile };
