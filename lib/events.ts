// Event types, the server's window filter and sort, and the display's state
// selection. Everything here is plain logic with no I/O, so it runs on the
// server, in the browser, and in tests.

import type { DisplayConfig } from './config';
import { formatDate, formatTime, formatWeekday, isNight, partOfDay, relativeTiming, splitTime } from './format';
import { strings } from './strings';
import { addDays, dateKeyAt, isoAt, minuteOfDayAt, startOfDayMs } from './tz';

/** One event as sent to the display. */
export type CalendarEvent = {
  id: string;
  title: string;
  /** Timed: "2026-10-14T16:00:00-07:00". All-day: "2026-10-14". */
  start: string;
  /** Timed: ISO with offset. All-day: the day after the last day (exclusive). */
  end: string;
  allDay: boolean;
  location?: string;
  note?: string;
};

export type EventsResponse = {
  generatedAt: string;
  timezone: string;
  events: CalendarEvent[];
};

/** One expanded occurrence, as produced by the ICS parser. */
export type Occurrence = {
  id: string;
  title: string;
  allDay: boolean;
  /** Timed events: instants in milliseconds. */
  startMs: number;
  endMs: number;
  /** All-day events: "YYYY-MM-DD", end exclusive. */
  startDate: string;
  endDate: string;
  location?: string;
  note?: string;
};

/**
 * The span the API returns: the start of today through the end of the last
 * day shown, plus one more day so the page can roll over at midnight before
 * its next fetch. With no days ahead that is today and tomorrow.
 */
export type DayWindow = {
  startDate: string;
  /** Exclusive. */
  endDate: string;
  startMs: number;
  endMs: number;
};

export function windowFor(nowMs: number, tz: string, daysAhead = 0): DayWindow {
  const startDate = dateKeyAt(nowMs, tz);
  const endDate = addDays(startDate, 2 + daysAhead);
  return { startDate, endDate, startMs: startOfDayMs(startDate, tz), endMs: startOfDayMs(endDate, tz) };
}

/** An event with no length still counts as happening at its start time. */
function effectiveEndMs(o: { startMs: number; endMs: number }): number {
  return Math.max(o.endMs, o.startMs + 1);
}

export function overlapsWindow(o: Occurrence, w: DayWindow): boolean {
  if (o.allDay) return o.startDate < w.endDate && o.endDate > w.startDate;
  return o.startMs < w.endMs && effectiveEndMs(o) > w.startMs;
}

/** Sort by day, all-day events first within each day, then by start time. */
export function sortOccurrences(list: Occurrence[], tz: string): Occurrence[] {
  const keyed = list.map((o) => ({ o, day: o.allDay ? o.startDate : dateKeyAt(o.startMs, tz) }));
  keyed.sort((a, b) => {
    if (a.day !== b.day) return a.day < b.day ? -1 : 1;
    if (a.o.allDay !== b.o.allDay) return a.o.allDay ? -1 : 1;
    if (!a.o.allDay && a.o.startMs !== b.o.startMs) return a.o.startMs - b.o.startMs;
    if (a.o.allDay && a.o.endDate !== b.o.endDate) return a.o.endDate < b.o.endDate ? -1 : 1;
    return a.o.title < b.o.title ? -1 : a.o.title > b.o.title ? 1 : 0;
  });
  return keyed.map((k) => k.o);
}

export function toCalendarEvent(o: Occurrence, tz: string): CalendarEvent {
  const event: CalendarEvent = {
    id: o.id,
    title: o.title,
    start: o.allDay ? o.startDate : isoAt(o.startMs, tz),
    end: o.allDay ? o.endDate : isoAt(o.endMs, tz),
    allDay: o.allDay,
  };
  if (o.location) event.location = o.location;
  if (o.note) event.note = o.note;
  return event;
}

/**
 * Filter to the window, drop duplicates (the same event on two calendars has
 * the same id), sort, and convert to the API shape.
 */
export function buildEvents(occurrences: Occurrence[], w: DayWindow, tz: string): CalendarEvent[] {
  const seen: { [id: string]: true } = {};
  const kept: Occurrence[] = [];
  for (const o of occurrences) {
    if (!overlapsWindow(o, w)) continue;
    if (seen[o.id]) continue;
    seen[o.id] = true;
    kept.push(o);
  }
  return sortOccurrences(kept, tz).map((o) => toCalendarEvent(o, tz));
}

// ---------------------------------------------------------------------------
// Display state. Everything below runs in the browser once a minute.

export type CardState = 'now' | 'soon' | 'comingUp' | 'later' | 'done';

export type Card = {
  state: CardState;
  label: string;
  title?: string;
  /** The main timing text: "in 20 minutes", "until 4:30 PM", "at 6:00 PM". */
  timing?: string;
  /** Smaller second timing line, such as "at 4:00 PM". */
  detail?: string;
  location?: string;
  note?: string;
  /** "Then: Lunch, in 20 minutes", shown under an event in progress. */
  then?: string;
};

export type RowStatus = 'past' | 'now' | 'upcoming';

export type Row = { id: string; time: string; title: string; status: RowStatus };

export type View = {
  /** Changes when the day changes. */
  dayKey: string;
  weekday: string;
  partOfDay: string;
  clock: string;
  period: string;
  periodFirst: boolean;
  date: string;
  night: boolean;
  card: Card;
  allDay: string[];
  past: Row[];
  /** The event in progress (if any) followed by the ones still to come. */
  current: Row[];
  /** The next `daysAhead` days that have events, starting tomorrow. */
  days: DayView[];
};

export type DayView = {
  /** "Tomorrow, Thursday" or "Friday". */
  label: string;
  allDay: string[];
  /** Timed events that start on this day, as time and title. */
  rows: { id: string; time: string; title: string }[];
};

type Timed = { e: CalendarEvent; startMs: number; endMs: number; status: RowStatus };

function titleOf(e: CalendarEvent): string {
  return e.title || strings.untitled;
}

/** Text after "until", naming the day when the event ends on another day. */
function untilText(endMs: number, todayKey: string, c: DisplayConfig): string {
  const time = formatTime(endMs, c.timezone, c.locale);
  const endKey = dateKeyAt(endMs - 1, c.timezone);
  if (endKey === todayKey) return strings.until(time);
  if (endKey === addDays(todayKey, 1)) return strings.untilTomorrow(time);
  return strings.untilDay(formatWeekday(endMs, c.timezone, c.locale), time);
}

/**
 * Events for the days after today. Each event is listed under the day it
 * starts, so an event that runs over several days is not repeated.
 */
function comingDays(events: CalendarEvent[], todayKey: string, c: DisplayConfig): DayView[] {
  const tz = c.timezone;
  const days: DayView[] = [];
  for (let d = 1; d <= c.daysAhead; d++) {
    const key = addDays(todayKey, d);
    const start = startOfDayMs(key, tz);
    const end = startOfDayMs(addDays(key, 1), tz);
    const weekday = formatWeekday(start + 12 * 3600000, tz, c.locale);
    const day: DayView = { label: d === 1 ? strings.tomorrow(weekday) : weekday, allDay: [], rows: [] };
    const timed: { e: CalendarEvent; startMs: number }[] = [];
    for (const e of events) {
      if (e.allDay) {
        if (e.start === key) day.allDay.push(titleOf(e));
        continue;
      }
      const startMs = Date.parse(e.start);
      if (isNaN(startMs) || startMs < start || startMs >= end) continue;
      // Starts at midnight and covers the whole day: reads like an all-day event.
      if (startMs === start && Date.parse(e.end) >= end) day.allDay.push(titleOf(e));
      else timed.push({ e, startMs });
    }
    timed.sort((a, b) => a.startMs - b.startMs);
    day.rows = timed.map((t) => ({ id: t.e.id, time: formatTime(t.startMs, tz, c.locale), title: titleOf(t.e) }));
    if (day.allDay.length || day.rows.length) days.push(day);
  }
  return days;
}

/** Builds everything the screen shows at the instant `nowMs`. */
export function buildView(events: CalendarEvent[], nowMs: number, c: DisplayConfig): View {
  const tz = c.timezone;
  // Work at whole minutes, matching what the clock shows.
  const now = Math.floor(nowMs / 60000) * 60000;
  const todayKey = dateKeyAt(now, tz);
  const dayStart = startOfDayMs(todayKey, tz);
  const dayEnd = startOfDayMs(addDays(todayKey, 1), tz);

  const allDay: string[] = [];
  const timed: Timed[] = [];
  for (const e of events) {
    if (e.allDay) {
      if (e.start <= todayKey && e.end > todayKey) allDay.push(titleOf(e));
      continue;
    }
    const startMs = Date.parse(e.start);
    const rawEnd = Date.parse(e.end);
    if (isNaN(startMs) || isNaN(rawEnd)) continue;
    // An event with no length still shows as "Now" for its first minute.
    const endMs = Math.max(rawEnd, startMs + 60000);
    if (startMs >= dayEnd || endMs <= dayStart) continue;
    // A timed event that covers the whole day reads like an all-day event,
    // and should not hold the Next card all day.
    if (startMs <= dayStart && endMs >= dayEnd) {
      allDay.push(titleOf(e));
      continue;
    }
    const status: RowStatus = endMs <= now ? 'past' : startMs <= now ? 'now' : 'upcoming';
    timed.push({ e, startMs, endMs, status });
  }
  timed.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const rowOf = (t: Timed): Row => ({
    id: t.e.id,
    time: t.startMs < dayStart ? untilText(t.endMs, todayKey, c) : formatTime(t.startMs, tz, c.locale),
    title: titleOf(t.e),
    status: t.status,
  });

  // The most recently started event in progress is the most relevant one.
  let inProgress: Timed | null = null;
  for (const t of timed) {
    if (t.status !== 'now') continue;
    if (!inProgress || t.startMs > inProgress.startMs || (t.startMs === inProgress.startMs && t.endMs < inProgress.endMs)) {
      inProgress = t;
    }
  }
  let nextUp: Timed | null = null;
  for (const t of timed) {
    if (t.status === 'upcoming') {
      nextUp = t;
      break;
    }
  }
  const minutesUntil = (t: Timed) => Math.round((t.startMs - now) / 60000);

  let card: Card;
  if (inProgress) {
    card = {
      state: 'now',
      label: strings.now,
      title: titleOf(inProgress.e),
      timing: untilText(inProgress.endMs, todayKey, c),
      detail: inProgress.startMs >= dayStart ? strings.startedAt(formatTime(inProgress.startMs, tz, c.locale)) : undefined,
      location: inProgress.e.location,
      note: inProgress.e.note,
    };
    if (nextUp && minutesUntil(nextUp) <= c.soonWindowMinutes) {
      card.then = strings.then(titleOf(nextUp.e), relativeTiming(minutesUntil(nextUp)));
    }
  } else if (nextUp) {
    const minutes = minutesUntil(nextUp);
    const at = strings.at(formatTime(nextUp.startMs, tz, c.locale));
    const base = { title: titleOf(nextUp.e), location: nextUp.e.location, note: nextUp.e.note };
    if (minutes <= c.soonWindowMinutes) {
      card = { state: 'soon', label: strings.soon, timing: relativeTiming(minutes), detail: at, ...base };
    } else if (minutes <= c.upcomingWindowMinutes) {
      card = { state: 'comingUp', label: strings.comingUp, timing: relativeTiming(minutes), detail: at, ...base };
    } else {
      card = { state: 'later', label: strings.next, timing: at, ...base };
    }
  } else {
    card = { state: 'done', label: strings.nothingElseToday };
  }

  const minuteOfDay = minuteOfDayAt(now, tz);
  const time = splitTime(now, tz, c.locale);
  return {
    days: comingDays(events, todayKey, c),
    dayKey: todayKey,
    weekday: formatWeekday(now, tz, c.locale),
    partOfDay: strings.partOfDay[partOfDay(minuteOfDay)],
    clock: time.clock,
    period: time.period,
    periodFirst: time.periodFirst,
    date: formatDate(now, tz, c.locale),
    night: isNight(minuteOfDay, c.nightStartMinute, c.nightEndMinute),
    card,
    allDay,
    past: timed.filter((t) => t.status === 'past').map(rowOf),
    current: timed.filter((t) => t.status !== 'past').map(rowOf),
  };
}

export type ListPlan = {
  /** How many of the earliest past events are not shown. */
  hiddenPast: number;
  /** Whether to show the "N earlier" line for them. */
  earlierLine: boolean;
  /** How many current and upcoming rows to show. */
  shownCurrent: number;
  /** How many upcoming events are behind a "+N more later" line. */
  moreLater: number;
};

/**
 * Decides what the Today list shows when only `capacity` rows fit. Hides the
 * earliest past events first, behind one "N earlier" line. If that is not
 * enough, shows as many upcoming events as fit and ends with "+N more later".
 * The event in progress (the first current row) is never pushed out by past
 * events.
 */
export function planList(pastCount: number, currentCount: number, hasAllDay: boolean, capacity: number): ListPlan {
  const room = Math.max(0, capacity - (hasAllDay ? 1 : 0));
  if (pastCount + currentCount <= room) {
    return { hiddenPast: 0, earlierLine: false, shownCurrent: currentCount, moreLater: 0 };
  }
  // Hiding a single event behind "1 earlier" saves no room, so start at two.
  for (let hide = 2; hide <= pastCount; hide++) {
    if (1 + (pastCount - hide) + currentCount <= room) {
      return { hiddenPast: hide, earlierLine: true, shownCurrent: currentCount, moreLater: 0 };
    }
  }
  // Past events now get one row: the "N earlier" line, or the event itself
  // if there is only one. If that leaves no room for a current row next to
  // the "+N more later" line, past events get no row at all.
  let pastRows = pastCount > 0 ? 1 : 0;
  if (pastRows && currentCount > 0 && room - pastRows < 2) pastRows = 0;
  const left = room - pastRows;
  const shown = currentCount <= left ? currentCount : Math.max(0, left - 1);
  return {
    hiddenPast: pastRows && pastCount === 1 ? 0 : pastCount,
    earlierLine: pastRows > 0 && pastCount > 1,
    shownCurrent: shown,
    moreLater: currentCount - shown,
  };
}

/** Rows a list plan takes, including the all-day row and summary lines. */
function rowsUsed(p: ListPlan, pastCount: number, hasAllDay: boolean): number {
  return (
    (hasAllDay ? 1 : 0) +
    (p.earlierLine ? 1 : 0) +
    (pastCount - p.hiddenPast) +
    p.shownCurrent +
    (p.moreLater > 0 ? 1 : 0)
  );
}

export type DayPlan = {
  /** Index into View.days. */
  index: number;
  /** How many of the day's rows to show (the all-day row counts as one). */
  shown: number;
  /** How many rows are behind a "+N more" (or "N events") line. */
  more: number;
};

export type FullPlan = { today: ListPlan; days: DayPlan[] };

/**
 * Plans today's list and then the coming days in `capacity` rows. Today
 * always comes first: coming days only get rows that today's events do not
 * need. To make room for them, today's past events fold into the "N earlier"
 * line, earliest first. Each coming day takes a heading row and at least one
 * more row, or is left out.
 *
 * `dayRows[i]` is the number of rows day i needs (its all-day row plus its
 * timed events).
 */
export function planFullList(
  pastCount: number,
  currentCount: number,
  hasAllDay: boolean,
  dayRows: number[],
  capacity: number,
): FullPlan {
  let today = planList(pastCount, currentCount, hasAllDay, capacity);
  if (today.moreLater > 0 || !dayRows.length) return { today, days: [] };

  let need = 0;
  for (const n of dayRows) need += n > 0 ? 1 + n : 0;
  if (rowsUsed(today, pastCount, hasAllDay) + need > capacity) {
    // Fold past events, earliest first, until everything fits or all are folded.
    for (let hide = Math.max(2, today.hiddenPast); hide <= pastCount; hide++) {
      today = { hiddenPast: hide, earlierLine: true, shownCurrent: today.shownCurrent, moreLater: 0 };
      if (rowsUsed(today, pastCount, hasAllDay) + need <= capacity) break;
    }
  }

  let room = capacity - rowsUsed(today, pastCount, hasAllDay);
  const days: DayPlan[] = [];
  for (let i = 0; i < dayRows.length; i++) {
    const n = dayRows[i];
    if (n === 0) continue;
    if (room < 2) break;
    if (1 + n <= room) {
      days.push({ index: i, shown: n, more: 0 });
      room -= 1 + n;
    } else {
      // Heading, as many rows as fit, and one line for the rest.
      const shown = Math.max(0, room - 2);
      days.push({ index: i, shown, more: n - shown });
      room = 0;
    }
  }
  return { today, days };
}
