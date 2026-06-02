export function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  let v = n;
  do { v /= 1024; i += 1; } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function ms(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1000) return `${n} ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)} s`;
  const m = Math.floor(n / 60_000);
  const s = Math.round((n - m * 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

export function dirname(p) {
  if (!p) return '';
  const parts = p.split(/[\\/]/);
  parts.pop();
  return parts.join('/');
}

export function ext(p) {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i >= 0 ? b.slice(i).toLowerCase() : '';
}
