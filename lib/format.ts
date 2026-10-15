// Formatting for the display: time, date, part of day and relative timing.
// Runs in the browser, so it sticks to Intl features that Safari 10 has.

import { strings } from './strings';
import { minuteOfDayAt } from './tz';

const cache: { [key: string]: Intl.DateTimeFormat } = {};

function formatter(locale: string, tz: string, kind: 'time' | 'weekday' | 'date'): Intl.DateTimeFormat {
  const key = locale + '|' + tz + '|' + kind;
  let f = cache[key];
  if (!f) {
    const options: Intl.DateTimeFormatOptions =
      kind === 'time'
        ? { timeZone: tz, hour: 'numeric', minute: '2-digit' }
        : kind === 'weekday'
          ? { timeZone: tz, weekday: 'long' }
          : { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric' };
    f = new Intl.DateTimeFormat(locale, options);
    cache[key] = f;
  }
  return f;
}

/** "3:42 PM". 12- or 24-hour follows the locale; en-US gives 12-hour. */
export function formatTime(ms: number, tz: string, locale: string): string {
  return formatter(locale, tz, 'time').format(new Date(ms));
}

/**
 * The time split into the clock digits and the AM/PM marker, so the marker
 * can be drawn smaller. `period` is empty for 24-hour locales.
 */
export function splitTime(ms: number, tz: string, locale: string): { clock: string; period: string; periodFirst: boolean } {
  const f = formatter(locale, tz, 'time');
  const date = new Date(ms);
  if (typeof f.formatToParts === 'function') {
    let clock = '';
    let period = '';
    let periodFirst = false;
    const parts = f.formatToParts(date);
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      // Older engines call the AM/PM part "dayperiod".
      if (p.type === 'dayPeriod' || (p.type as string) === 'dayperiod') {
        period = p.value;
        if (!clock.trim()) periodFirst = true;
      } else if (p.type === 'hour' || p.type === 'minute' || (p.type === 'literal' && /[:.]/.test(p.value))) {
        clock += p.value;
      }
    }
    if (clock) return { clock, period, periodFirst };
  }
  const text = f.format(date);
  const match = /^(.*?\d)\s*([^\d\s:.].*)$/.exec(text);
  return match ? { clock: match[1], period: match[2], periodFirst: false } : { clock: text, period: '', periodFirst: false };
}

export function formatWeekday(ms: number, tz: string, locale: string): string {
  return formatter(locale, tz, 'weekday').format(new Date(ms));
}

/** "October 14, 2026" */
export function formatDate(ms: number, tz: string, locale: string): string {
  return formatter(locale, tz, 'date').format(new Date(ms));
}

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/** Morning 5:00–11:59, Afternoon 12:00–16:59, Evening 17:00–20:59, Night 21:00–4:59. */
export function partOfDay(minuteOfDay: number): PartOfDay {
  const hour = Math.floor(minuteOfDay / 60);
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export function partOfDayAt(ms: number, tz: string): PartOfDay {
  return partOfDay(minuteOfDayAt(ms, tz));
}

/** True between NIGHT_START and NIGHT_END, which may wrap past midnight. */
export function isNight(minuteOfDay: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) return minuteOfDay >= startMinute && minuteOfDay < endMinute;
  return minuteOfDay >= startMinute || minuteOfDay < endMinute;
}

/**
 * "starting now", "in 1 minute", "in 20 minutes", "in 1 hour 15 minutes",
 * "in 2 hours". From an hour up, minutes are rounded to the nearest 5.
 */
export function relativeTiming(minutes: number): string {
  if (minutes <= 0) return strings.startingNow;
  if (minutes < 60) return strings.inMinutes(minutes);
  let hours = Math.floor(minutes / 60);
  let rest = Math.round((minutes % 60) / 5) * 5;
  if (rest === 60) {
    hours += 1;
    rest = 0;
  }
  return strings.inHours(hours, rest);
}
