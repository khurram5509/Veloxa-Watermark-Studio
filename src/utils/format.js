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

/**
 * Humanize a past timestamp into "Just now", "5 minutes ago", "2 hours ago",
 * "Yesterday", "3 days ago", or a locale date string for older dates.
 * Returns 'Never' for null/undefined/0.
 */
export function relativeTime(ts) {
  if (!ts) return 'Never';
  const now = Date.now();
  const diff = now - ts;
  if (diff < 0) return new Date(ts).toLocaleString(); // future timestamps fall through
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 2) return '1 minute ago';
  if (min < 60) return `${min} minutes ago`;
  const hr = Math.floor(min / 60);
  if (hr < 2) return '1 hour ago';
  if (hr < 24) return `${hr} hours ago`;
  const day = Math.floor(hr / 24);
  if (day < 2) return 'Yesterday';
  if (day < 7) return `${day} days ago`;
  return new Date(ts).toLocaleDateString();
}
