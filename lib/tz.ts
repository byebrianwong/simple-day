// Time zone math built on Intl.DateTimeFormat, so it needs no time zone
// database of its own. Used on the server and in the browser.
//
// A "wall" time is what a clock on the wall shows in a given zone: year,
// month, day, hour, minute, second. An "instant" is milliseconds since
// 1970-01-01T00:00:00Z, the same everywhere.

export type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number };
export type DateParts = { y: number; m: number; d: number };

const DAY_MS = 86400000;

const formatters: { [tz: string]: Intl.DateTimeFormat } = {};

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters[tz];
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters[tz] = f;
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The wall time in `tz` at the given instant. */
export function wallAt(ms: number, tz: string): Wall {
  const f = partsFormatter(tz);
  const date = new Date(ms);
  const w: Wall = { y: 0, m: 0, d: 0, h: 0, mi: 0, s: 0 };
  if (typeof f.formatToParts === 'function') {
    const parts = f.formatToParts(date);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const n = parseInt(p.value, 10);
      if (p.type === 'year') w.y = n;
      else if (p.type === 'month') w.m = n;
      else if (p.type === 'day') w.d = n;
      else if (p.type === 'hour') w.h = n;
      else if (p.type === 'minute') w.mi = n;
      else if (p.type === 'second') w.s = n;
    }
  } else {
    // Older Safari has no formatToParts. The en-US numeric format is
    // "10/14/2026, 16:05:00".
    const match = /(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)/.exec(f.format(date));
    if (match) {
      w.m = +match[1];
      w.d = +match[2];
      w.y = +match[3];
      w.h = +match[4];
      w.mi = +match[5];
      w.s = +match[6];
    }
  }
  // Some engines write midnight as hour 24 when hour12 is false.
  if (w.h === 24) w.h = 0;
  return w;
}

/** How far `tz` is ahead of UTC at the given instant, in milliseconds. */
export function offsetAt(ms: number, tz: string): number {
  const whole = Math.floor(ms / 1000) * 1000;
  const w = wallAt(whole, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - whole;
}

function sameWall(a: Wall, b: Wall): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d && a.h === b.h && a.mi === b.mi && a.s === b.s;
}

/**
 * The instant at which clocks in `tz` show the given wall time.
 *
 * When clocks fall back, a wall time happens twice; this returns the first
 * one. When clocks spring forward, a wall time never happens; this moves it
 * later by the size of the jump (2:30 AM becomes 3:30 AM). Both rules match
 * RFC 5545 and JavaScript's Temporal "compatible" mode.
 */
export function wallToMs(w: Wall, tz: string): number {
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  const before = offsetAt(asUtc - DAY_MS, tz);
  const after = offsetAt(asUtc + DAY_MS, tz);
  if (before === after) return asUtc - before;
  const first = asUtc - before;
  const second = asUtc - after;
  const firstOk = sameWall(wallAt(first, tz), w);
  const secondOk = sameWall(wallAt(second, tz), w);
  if (firstOk && secondOk) return Math.min(first, second);
  if (firstOk) return first;
  if (secondOk) return second;
  // In the gap: use the offset from before the jump.
  return first;
}

function pad(n: number, width = 2): string {
  let s = String(Math.abs(n));
  while (s.length < width) s = '0' + s;
  return (n < 0 ? '-' : '') + s;
}

export function dateKey(p: DateParts): string {
  return pad(p.y, 4) + '-' + pad(p.m) + '-' + pad(p.d);
}

export function parseDateKey(key: string): DateParts {
  return { y: parseInt(key.slice(0, 4), 10), m: parseInt(key.slice(5, 7), 10), d: parseInt(key.slice(8, 10), 10) };
}

/** The calendar date ("2026-10-14") in `tz` at the given instant. */
export function dateKeyAt(ms: number, tz: string): string {
  return dateKey(wallAt(ms, tz));
}

export function addDays(key: string, days: number): string {
  const p = parseDateKey(key);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + days));
  return dateKey({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** Whole days from date `a` to date `b`. */
export function daysBetween(a: string, b: string): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / DAY_MS);
}

/** The instant the given date starts in `tz`. */
export function startOfDayMs(key: string, tz: string): number {
  const p = parseDateKey(key);
  return wallToMs({ y: p.y, m: p.m, d: p.d, h: 0, mi: 0, s: 0 }, tz);
}

/** "2026-10-14T16:00:00-07:00": the instant written as wall time in `tz`. */
export function isoAt(ms: number, tz: string): string {
  const whole = Math.floor(ms / 1000) * 1000;
  const w = wallAt(whole, tz);
  const offsetMin = Math.round((Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - whole) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return (
    dateKey(w) + 'T' + pad(w.h) + ':' + pad(w.mi) + ':' + pad(w.s) + sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
  );
}

/** Minutes since midnight on the wall clock in `tz`. */
export function minuteOfDayAt(ms: number, tz: string): number {
  const w = wallAt(ms, tz);
  return w.h * 60 + w.mi;
}

/**
 * Reads the `?now=` debug value. "2026-10-14T15:40" is a wall time in `tz`;
 * a value ending in Z or an offset is an exact instant. Returns null when
 * the value is missing or unreadable.
 */
export function parseNowOverride(value: string | null | undefined, tz: string): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/T\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/.test(v)) {
    const ms = Date.parse(v);
    return isNaN(ms) ? null : ms;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(v);
  if (!m) return null;
  return wallToMs({ y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) }, tz);
}
