// Fetches iCal feeds and expands them into occurrences. Server only.
//
// Recurrences are expanded in the event's own wall-clock time ("every
// Wednesday at 10:00 in Los Angeles"), and each occurrence is converted to an
// instant afterwards with Intl. That keeps an event at 10:00 across daylight
// saving changes. ical.js does the RRULE expansion; this file handles time
// zones, UNTIL, EXDATE, and moved or cancelled instances (RECURRENCE-ID)
// itself, because ical.js only knows zones that the feed defines with a
// VTIMEZONE block.

import ICAL from 'ical.js';
import type { DayWindow, Occurrence } from './events';
import { overlapsWindow } from './events';
import { dateKey, daysBetween, addDays, isValidTimeZone, wallAt, wallToMs, type Wall } from './tz';

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalProperty = InstanceType<typeof ICAL.Property>;
type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalTimezone = InstanceType<typeof ICAL.Timezone>;

const DAY_MS = 86400000;
/** Stop expanding one series after this many occurrences, whatever happens. */
const MAX_OCCURRENCES_PER_SERIES = 100000;
const NOTE_MAX_LENGTH = 120;

// ---------------------------------------------------------------------------
// Time zones

type Zone = { toMs(w: Wall): number; toWall(ms: number): Wall };

const utcZone: Zone = {
  toMs: (w) => Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s),
  toWall: (ms) => {
    const d = new Date(ms);
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      h: d.getUTCHours(),
      mi: d.getUTCMinutes(),
      s: d.getUTCSeconds(),
    };
  },
};

function ianaZone(tz: string): Zone {
  return { toMs: (w) => wallToMs(w, tz), toWall: (ms) => wallAt(ms, tz) };
}

function vtimezoneZone(zone: IcalTimezone): Zone {
  return {
    toMs: (w) =>
      new ICAL.Time({ year: w.y, month: w.m, day: w.d, hour: w.h, minute: w.mi, second: w.s, isDate: false }, zone).toUnixTime() *
      1000,
    toWall: (ms) => {
      const t = new ICAL.Time({ year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0, isDate: false }, ICAL.Timezone.utcTimezone);
      t.fromUnixTime(Math.floor(ms / 1000));
      const local = t.convertToZone(zone);
      return wallOf(local);
    },
  };
}

type Context = {
  displayZone: Zone;
  vtimezones: { [tzid: string]: IcalTimezone };
  zones: { [tzid: string]: Zone };
};

/**
 * Finds the zone for a TZID. Prefers the IANA name through Intl. Some
 * programs prefix the name ("/mozilla.org/20050126_1/America/New_York"), so
 * trailing parts of the path are tried too. Falls back to the feed's own
 * VTIMEZONE block, and last to the display zone.
 */
function zoneForTzid(tzid: string, ctx: Context): Zone {
  const known = ctx.zones[tzid];
  if (known) return known;
  let zone: Zone | null = null;
  const parts = tzid.split('/').filter(Boolean);
  for (let i = 0; i < parts.length && !zone; i++) {
    const candidate = parts.slice(i).join('/');
    if (isValidTimeZone(candidate)) zone = ianaZone(candidate);
  }
  if (!zone && ctx.vtimezones[tzid]) zone = vtimezoneZone(ctx.vtimezones[tzid]);
  if (!zone) zone = ctx.displayZone;
  ctx.zones[tzid] = zone;
  return zone;
}

function wallOf(t: IcalTime): Wall {
  return { y: t.year, m: t.month, d: t.day, h: t.hour, mi: t.minute, s: t.second };
}

function isUtc(t: IcalTime): boolean {
  return !!t.zone && t.zone.tzid === 'UTC';
}

/** The zone a time value is written in. Floating times use the display zone. */
function zoneOf(t: IcalTime, prop: IcalProperty | null, ctx: Context): Zone {
  if (isUtc(t)) return utcZone;
  // ical.js keeps the TZID on the value even when the feed has no VTIMEZONE
  // for it, but its types do not declare the field.
  const tzid = (prop && (prop.getParameter('tzid') as string | undefined)) || (t as unknown as { timezone?: string }).timezone;
  if (tzid) return zoneForTzid(String(tzid), ctx);
  return ctx.displayZone;
}

type Moment = { allDay: true; date: string; ms: 0 } | { allDay: false; date: ''; ms: number };

function momentOf(t: IcalTime, prop: IcalProperty | null, ctx: Context): Moment {
  if (t.isDate) return { allDay: true, date: dateKey({ y: t.year, m: t.month, d: t.day }), ms: 0 };
  return { allDay: false, date: '', ms: zoneOf(t, prop, ctx).toMs(wallOf(t)) };
}

// ---------------------------------------------------------------------------
// Text fields

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/gi, '&');
}

/** The first non-empty line of a description, without HTML, at most 120 characters. */
export function extractNote(description: string | null | undefined): string | undefined {
  if (!description) return undefined;
  let text = String(description);
  // Google appends video call details after this divider. Never show them.
  const divider = text.indexOf('-::~:~::~:');
  if (divider >= 0) text = text.slice(0, divider);
  text = text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  text = decodeEntities(text);
  const lines = text.split(/\r\n|\r|\n/);
  for (const line of lines) {
    const t = line.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (t.length <= NOTE_MAX_LENGTH) return t;
    return t.slice(0, NOTE_MAX_LENGTH - 1).trimEnd() + '…';
  }
  return undefined;
}

function textProp(c: IcalComponent, name: string): string {
  const v = c.getFirstPropertyValue(name);
  return v == null ? '' : String(v).trim();
}

function isCancelled(c: IcalComponent): boolean {
  return textProp(c, 'status').toUpperCase() === 'CANCELLED';
}

// ---------------------------------------------------------------------------
// Expansion

/** Length of an event: whole days for all-day events, milliseconds otherwise. */
function lengthOf(vevent: IcalComponent, start: Moment, ctx: Context): { days: number; ms: number } {
  const endProp = vevent.getFirstProperty('dtend');
  if (endProp) {
    const end = momentOf(endProp.getFirstValue() as IcalTime, endProp, ctx);
    if (start.allDay) return { days: end.allDay ? Math.max(1, daysBetween(start.date, end.date)) : 1, ms: 0 };
    return { days: 0, ms: end.allDay ? 0 : Math.max(0, end.ms - start.ms) };
  }
  const duration = vevent.getFirstPropertyValue('duration') as InstanceType<typeof ICAL.Duration> | null;
  if (duration) {
    const seconds = duration.toSeconds();
    if (start.allDay) return { days: Math.max(1, Math.round(seconds / 86400)), ms: 0 };
    return { days: 0, ms: Math.max(0, seconds * 1000) };
  }
  return start.allDay ? { days: 1, ms: 0 } : { days: 0, ms: 0 };
}

function stamp(m: Moment): string {
  if (m.allDay) return m.date.replace(/-/g, '');
  return new Date(m.ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function recurrenceKey(m: Moment): string {
  return m.allDay ? 'd' + m.date : 't' + m.ms;
}

function makeOccurrence(
  uid: string,
  instance: Moment,
  start: Moment,
  len: { days: number; ms: number },
  vevent: IcalComponent,
): Occurrence {
  const location = textProp(vevent, 'location');
  const note = extractNote(textProp(vevent, 'description'));
  const o: Occurrence = {
    id: uid + '_' + stamp(instance),
    title: textProp(vevent, 'summary'),
    allDay: start.allDay,
    startMs: start.allDay ? 0 : start.ms,
    endMs: start.allDay ? 0 : start.ms + len.ms,
    startDate: start.allDay ? start.date : '',
    endDate: start.allDay ? addDays(start.date, len.days) : '',
  };
  if (location) o.location = location;
  if (note) o.note = note;
  return o;
}

/** Converts a recurrence time from the event's zone to a floating ical.js time. */
function floating(w: Wall, isDate: boolean): IcalTime {
  return ICAL.Time.fromData({ year: w.y, month: w.m, day: w.d, hour: w.h, minute: w.mi, second: w.s, isDate });
}

function expandSeries(
  vevent: IcalComponent,
  uid: string,
  overridden: { [key: string]: true },
  w: DayWindow,
  ctx: Context,
  out: Occurrence[],
): void {
  const startProp = vevent.getFirstProperty('dtstart');
  if (!startProp) return;
  const dtstart = startProp.getFirstValue() as IcalTime;
  const first = momentOf(dtstart, startProp, ctx);
  const len = lengthOf(vevent, first, ctx);
  const zone = first.allDay ? ctx.displayZone : zoneOf(dtstart, startProp, ctx);

  const recurring = vevent.hasProperty('rrule') || vevent.hasProperty('rdate');
  if (!recurring) {
    const o = makeOccurrence(uid, first, first, len, vevent);
    if (overlapsWindow(o, w)) out.push(o);
    return;
  }

  // Excluded dates, matched by instant (or by date for all-day series).
  const excluded: { [key: string]: true } = {};
  for (const prop of vevent.getAllProperties('exdate')) {
    for (const value of prop.getValues() as IcalTime[]) {
      const m = momentOf(value, prop, ctx);
      excluded[recurrenceKey(m)] = true;
      if (m.allDay) excluded['date:' + m.date] = true;
    }
  }

  // Expand a copy in floating time with EXDATE removed and UNTIL rewritten
  // into the event's wall-clock time.
  const copy = new ICAL.Component(JSON.parse(JSON.stringify(vevent.toJSON())));
  copy.removeAllProperties('exdate');
  for (const prop of copy.getAllProperties('rrule')) {
    const recur = prop.getFirstValue() as InstanceType<typeof ICAL.Recur>;
    const until = recur.until;
    if (until && !until.isDate) {
      const untilWall = isUtc(until) ? zone.toWall(until.toUnixTime() * 1000) : wallOf(until);
      recur.until = floating(untilWall, false);
      prop.setValue(recur);
    } else if (until && until.isDate && !first.allDay) {
      // A date-only UNTIL on a timed series includes that whole day.
      recur.until = floating({ y: until.year, m: until.month, d: until.day, h: 23, mi: 59, s: 59 }, false);
      prop.setValue(recur);
    }
  }

  const expansion = new ICAL.RecurExpansion({ component: copy, dtstart: floating(wallOf(dtstart), first.allDay) });
  for (let i = 0; i < MAX_OCCURRENCES_PER_SERIES; i++) {
    const t = expansion.next();
    if (!t) break;
    let instance: Moment;
    if (first.allDay) {
      const date = dateKey({ y: t.year, m: t.month, d: t.day });
      if (date >= w.endDate) break;
      if (addDays(date, len.days) <= w.startDate) continue;
      instance = { allDay: true, date, ms: 0 };
    } else {
      // Treating the wall time as UTC is off by at most a day, which is
      // enough to skip far-away occurrences without converting them.
      const approx = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
      if (approx - 2 * DAY_MS > w.endMs) break;
      if (approx + len.ms + 2 * DAY_MS < w.startMs) continue;
      const own = t.zone && t.zone.tzid !== 'floating' ? zoneOf(t, null, ctx) : zone;
      instance = { allDay: false, date: '', ms: own.toMs(wallOf(t)) };
      if (excluded['date:' + dateKey({ y: t.year, m: t.month, d: t.day })]) continue;
    }
    const key = recurrenceKey(instance);
    if (excluded[key] || overridden[key]) continue;
    const o = makeOccurrence(uid, instance, instance, len, vevent);
    if (overlapsWindow(o, w)) out.push(o);
  }
}

export type ParsedCalendar = IcalComponent;

export function parseCalendar(text: string): ParsedCalendar {
  return new ICAL.Component(ICAL.parse(text));
}

/** Expands one calendar into occurrences that overlap the window. */
export function expandCalendar(cal: ParsedCalendar | string, opts: { timezone: string; window: DayWindow }): Occurrence[] {
  const root = typeof cal === 'string' ? parseCalendar(cal) : cal;
  const ctx: Context = { displayZone: ianaZone(opts.timezone), vtimezones: {}, zones: {} };
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const tzid = textProp(vtz, 'tzid');
    if (tzid) ctx.vtimezones[tzid] = new ICAL.Timezone(vtz);
  }

  const out: Occurrence[] = [];
  const vevents = root.getAllSubcomponents('vevent');

  // Instances that were moved, retitled or cancelled are separate VEVENTs
  // with a RECURRENCE-ID naming the original instance.
  const overridesByUid: { [uid: string]: { [key: string]: true } } = {};
  for (const vevent of vevents) {
    const ridProp = vevent.getFirstProperty('recurrence-id');
    if (!ridProp) continue;
    const uid = textProp(vevent, 'uid');
    const rid = momentOf(ridProp.getFirstValue() as IcalTime, ridProp, ctx);
    (overridesByUid[uid] = overridesByUid[uid] || {})[recurrenceKey(rid)] = true;
    if (isCancelled(vevent)) continue;
    const startProp = vevent.getFirstProperty('dtstart');
    if (!startProp) continue;
    const start = momentOf(startProp.getFirstValue() as IcalTime, startProp, ctx);
    const o = makeOccurrence(uid, rid, start, lengthOf(vevent, start, ctx), vevent);
    if (overlapsWindow(o, opts.window)) out.push(o);
  }

  for (const vevent of vevents) {
    if (vevent.hasProperty('recurrence-id') || isCancelled(vevent)) continue;
    const uid = textProp(vevent, 'uid');
    expandSeries(vevent, uid, overridesByUid[uid] || {}, opts.window, ctx, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetching

const FRESH_MS = 60 * 1000;
/** If a fetch fails, keep using the last good copy for this long. */
const STALE_LIMIT_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;

type CacheEntry = { calendar: ParsedCalendar; fetchedAt: number };
const cache: { [url: string]: CacheEntry } = {};
const inFlight: { [url: string]: Promise<ParsedCalendar> } = {};

async function download(url: string): Promise<ParsedCalendar> {
  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: 'text/calendar' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  if (text.indexOf('BEGIN:VCALENDAR') < 0) throw new Error('response is not an iCal feed');
  return parseCalendar(text);
}

/**
 * Returns the parsed feed, fetched at most once a minute per server
 * instance. `label` names the feed in logs, because the URL is a secret.
 */
export async function loadCalendar(url: string, label: string): Promise<ParsedCalendar> {
  const now = Date.now();
  const hit = cache[url];
  if (hit && now - hit.fetchedAt < FRESH_MS) return hit.calendar;
  if (!inFlight[url]) {
    inFlight[url] = download(url)
      .then((calendar) => {
        cache[url] = { calendar, fetchedAt: Date.now() };
        return calendar;
      })
      .finally(() => {
        delete inFlight[url];
      });
  }
  try {
    return await inFlight[url];
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (hit && now - hit.fetchedAt < STALE_LIMIT_MS) {
      console.warn(`${label}: fetch failed (${reason}); using the copy from ${new Date(hit.fetchedAt).toISOString()}`);
      return hit.calendar;
    }
    console.error(`${label}: fetch failed (${reason})`);
    throw err;
  }
}
