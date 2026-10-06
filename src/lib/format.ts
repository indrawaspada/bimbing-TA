const TZ = 'Asia/Jakarta';

export function fmtDate(iso?: string | null, withTime = false) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(new Date(iso)) + (withTime ? ' WIB' : '');
}

export function fmtRelative(iso?: string | null) {
  if (!iso) return '—';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('id-ID', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return 'baru saja';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

/** 'YYYY-MM-DD' in Jakarta for <input type=date>; stored as end of that day in WIB. */
export function toDateInput(iso?: string | null) {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p;
}
export function fromDateInput(v: string) {
  return v ? new Date(`${v}T23:59:00+07:00`).toISOString() : null;
}

export function daysUntil(iso?: string | null) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

export function bytes(n?: number | null) {
  if (!n) return '0 MB';
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}
