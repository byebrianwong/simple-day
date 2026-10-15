import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEvents, windowFor, type CalendarEvent } from '@/lib/events';
import { expandCalendar, extractNote } from '@/lib/ics';
import { demoCalendar } from '@/lib/demo';
import { parseNowOverride } from '@/lib/tz';

const LA = 'America/Los_Angeles';

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');
}

/** The API's events for the day `today` (at noon), given one or more calendars. */
function eventsFor(files: string | string[], today: string, tz = LA): CalendarEvent[] {
  const nowMs = parseNowOverride(today + 'T12:00', tz)!;
  const w = windowFor(nowMs, tz);
  const list = typeof files === 'string' ? [files] : files;
  const occurrences = list.flatMap((f) => expandCalendar(fixture(f), { timezone: tz, window: w }));
  return buildEvents(occurrences, w, tz);
}

function brief(events: CalendarEvent[]): [string, string, string][] {
  return events.map((e) => [e.title, e.start, e.end]);
}

describe('single timed event', () => {
  const events = eventsFor('single.ics', '2026-10-14');

  it('returns events from today and tomorrow only', () => {
    expect(brief(events)).toEqual([
      ['Doctor: Dr. Lee', '2026-10-14T16:00:00-07:00', '2026-10-14T16:30:00-07:00'],
      ['Tomorrow morning', '2026-10-15T09:00:00-07:00', '2026-10-15T10:00:00-07:00'],
    ]);
  });

  it('includes location, note and a stable id', () => {
    expect(events[0]).toEqual({
      id: 'single-1@google.com_20261014T230000Z',
      title: 'Doctor: Dr. Lee',
      start: '2026-10-14T16:00:00-07:00',
      end: '2026-10-14T16:30:00-07:00',
      allDay: false,
      location: '123 Main St, Springfield',
      note: 'Bring insurance card',
    });
    expect(events[1]).not.toHaveProperty('note');
    expect(events[1]).not.toHaveProperty('location');
  });
});

describe('all-day event', () => {
  const events = eventsFor('allday.ics', '2026-10-14');

  it('uses date strings with an exclusive end and sorts before timed events', () => {
    expect(events.map((e) => [e.title, e.start, e.end, e.allDay])).toEqual([
      ['Trash day', '2026-10-14', '2026-10-15', true],
      ['Timed on the same day', '2026-10-14T08:00:00-07:00', '2026-10-14T09:00:00-07:00', false],
      ['No end date', '2026-10-15', '2026-10-16', true],
    ]);
  });
});

describe('weekly recurring event', () => {
  it('expands to the matching day', () => {
    expect(brief(eventsFor('weekly.ics', '2026-10-14'))).toEqual([
      ['Book club', '2026-10-14T10:00:00-07:00', '2026-10-14T11:00:00-07:00'],
      ['Thursday class', '2026-10-15T14:00:00-07:00', '2026-10-15T15:00:00-07:00'],
    ]);
  });

  it('gives each occurrence its own id', () => {
    const [a] = eventsFor('weekly.ics', '2026-10-14');
    const [b] = eventsFor('weekly.ics', '2026-10-21');
    expect(a.id).toBe('weekly-1@google.com_20261014T170000Z');
    expect(b.id).toBe('weekly-1@google.com_20261021T170000Z');
  });

  it('stops at COUNT', () => {
    // 100 weekly occurrences from 2026-01-01 end on 2027-11-25.
    expect(brief(eventsFor('weekly.ics', '2027-11-24')).map((e) => e[0])).toContain('Thursday class');
    expect(brief(eventsFor('weekly.ics', '2027-12-01')).map((e) => e[0])).not.toContain('Thursday class');
  });
});

describe('recurring event with a moved instance (RECURRENCE-ID)', () => {
  it('shows the moved instance instead of the original', () => {
    expect(brief(eventsFor('moved.ics', '2026-10-14'))).toEqual([
      ['Book club (moved)', '2026-10-14T14:00:00-07:00', '2026-10-14T15:00:00-07:00'],
      ['Book club (moved up a week)', '2026-10-15T09:00:00-07:00', '2026-10-15T10:00:00-07:00'],
    ]);
  });

  it('keeps the original instance id on the moved event', () => {
    const events = eventsFor('moved.ics', '2026-10-14');
    expect(events[0].id).toBe('moved-1@google.com_20261014T170000Z');
    expect(events[1].id).toBe('moved-1@google.com_20261021T170000Z');
  });

  it('does not show the original slot of an instance moved to another week', () => {
    expect(brief(eventsFor('moved.ics', '2026-10-21'))).toEqual([]);
  });
});

describe('recurring event with a deleted instance (EXDATE)', () => {
  it('skips excluded timed and all-day instances', () => {
    expect(brief(eventsFor('exdate.ics', '2026-10-14'))).toEqual([
      ['Daily reminder', '2026-10-14', '2026-10-15'],
      ['Pills', '2026-10-14T08:00:00-07:00', '2026-10-14T08:30:00-07:00'],
    ]);
  });

  it('matches an EXDATE written in UTC against a local series', () => {
    const titles = eventsFor('exdate.ics', '2026-10-15').map((e) => e.title + ' ' + e.start);
    expect(titles).not.toContain('Pills 2026-10-15T08:00:00-07:00');
    expect(titles).toContain('Pills 2026-10-16T08:00:00-07:00');
  });
});

describe('cancelled events', () => {
  it('skips cancelled events and cancelled instances', () => {
    expect(brief(eventsFor('cancelled.ics', '2026-10-14'))).toEqual([
      ['Lunch', '2026-10-14T12:00:00-07:00', '2026-10-14T13:00:00-07:00'],
    ]);
  });

  it('keeps the other instances of a series with one cancelled instance', () => {
    expect(brief(eventsFor('cancelled.ics', '2026-10-21')).map((e) => e[0])).toEqual(['Book club']);
  });
});

describe('events in other time zones', () => {
  const events = eventsFor('tzid.ics', '2026-10-14');

  it('converts every zone to the display zone', () => {
    expect(brief(events)).toEqual([
      ['Prefixed zone name', '2026-10-14T08:00:00-07:00', '2026-10-14T08:30:00-07:00'],
      ['Call with New York', '2026-10-14T09:00:00-07:00', '2026-10-14T10:00:00-07:00'],
      ['Call with London', '2026-10-14T10:00:00-07:00', '2026-10-14T11:00:00-07:00'],
      ['UTC event', '2026-10-14T13:00:00-07:00', '2026-10-14T14:00:00-07:00'],
      ['Outlook zone name', '2026-10-14T15:00:00-07:00', '2026-10-14T15:30:00-07:00'],
      // Thursday 9:00 in Tokyo is Wednesday 17:00 in Los Angeles. Its UNTIL
      // is exactly this instance, written in UTC.
      ['Call with Tokyo', '2026-10-14T17:00:00-07:00', '2026-10-14T18:00:00-07:00'],
    ]);
  });

  it('works the same when the display zone is somewhere else', () => {
    const london = eventsFor('tzid.ics', '2026-10-14', 'Europe/London');
    expect(london.find((e) => e.title === 'Call with London')!.start).toBe('2026-10-14T18:00:00+01:00');
    expect(london.find((e) => e.title === 'Call with New York')!.start).toBe('2026-10-14T17:00:00+01:00');
  });
});

describe('multi-day events', () => {
  it('includes multi-day events that cover today', () => {
    expect(brief(eventsFor('multiday.ics', '2026-10-14'))).toEqual([
      ['Hospital stay', '2026-10-12T09:00:00-07:00', '2026-10-16T17:00:00-07:00'],
      ['Susan is visiting', '2026-10-13', '2026-10-17'],
    ]);
  });
});

describe('timed events crossing midnight', () => {
  it('includes events that overlap today or tomorrow, and nothing that only touches the edges', () => {
    expect(brief(eventsFor('midnight.ics', '2026-10-14'))).toEqual([
      ['Last night into today', '2026-10-13T23:00:00-07:00', '2026-10-14T01:00:00-07:00'],
      ['Late tonight', '2026-10-14T23:00:00-07:00', '2026-10-15T01:00:00-07:00'],
      ['Tomorrow night', '2026-10-15T23:30:00-07:00', '2026-10-16T00:30:00-07:00'],
    ]);
  });
});

describe('daylight saving transition (2026-11-01 in Los Angeles)', () => {
  it('keeps a daily 9:00 event at 9:00 on both sides of the change', () => {
    const before = eventsFor('dst.ics', '2026-10-31').filter((e) => e.title === 'Morning pills');
    expect(before.map((e) => e.start)).toEqual(['2026-10-31T09:00:00-07:00', '2026-11-01T09:00:00-08:00']);
  });

  it('handles the repeated hour and an event that spans it', () => {
    expect(brief(eventsFor('dst.ics', '2026-11-01'))).toEqual([
      ['Across the change', '2026-11-01T00:30:00-07:00', '2026-11-01T03:30:00-08:00'],
      // 1:30 happens twice; RFC 5545 says use the first.
      ['During the repeated hour', '2026-11-01T01:30:00-07:00', '2026-11-01T01:45:00-07:00'],
      ['Morning pills', '2026-11-01T09:00:00-08:00', '2026-11-01T09:30:00-08:00'],
      ['Morning pills', '2026-11-02T09:00:00-08:00', '2026-11-02T09:30:00-08:00'],
    ]);
  });

  it('computes a 25-hour day for the window', () => {
    const w = windowFor(parseNowOverride('2026-11-01T12:00', LA)!, LA);
    expect(new Date(w.startMs).toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(new Date(w.endMs).toISOString()).toBe('2026-11-03T08:00:00.000Z');
  });

  it('moves a time in the skipped spring hour forward', () => {
    const [e] = eventsFor('dst.ics', '2027-03-14').filter((x) => x.title === 'In the skipped hour');
    expect(e.start).toBe('2027-03-14T03:30:00-07:00');
  });
});

describe('several calendars', () => {
  it('merges, sorts and removes the same event shared on two calendars', () => {
    const events = eventsFor(['single.ics', 'allday.ics', 'single.ics'], '2026-10-14');
    expect(events.map((e) => e.title)).toEqual([
      'Trash day',
      'Timed on the same day',
      'Doctor: Dr. Lee',
      'No end date',
      'Tomorrow morning',
    ]);
  });
});

describe('extractNote', () => {
  it('takes the first non-empty line without HTML', () => {
    expect(extractNote('\n\n  <p>Bring&nbsp;insurance &amp; ID</p><p>Second</p>')).toBe('Bring insurance & ID');
    expect(extractNote('<br><br>First<br>Second')).toBe('First');
    expect(extractNote('Line one\nLine two')).toBe('Line one');
  });

  it('returns nothing for an empty description', () => {
    expect(extractNote('')).toBeUndefined();
    expect(extractNote('  <br> \n ')).toBeUndefined();
    expect(extractNote(undefined)).toBeUndefined();
  });

  it('trims to 120 characters', () => {
    const note = extractNote('x'.repeat(200))!;
    expect(note.length).toBe(120);
    expect(note.endsWith('…')).toBe(true);
  });

  it('ignores the video call block Google appends', () => {
    const meet = '-::~:~::~:~:~:~:~:~:~:~:~:~::~:~::-\nJoin with Google Meet: https://meet.google.com/abc';
    expect(extractNote(meet)).toBeUndefined();
    expect(extractNote('Wear the blue shirt\n\n' + meet)).toBe('Wear the blue shirt');
  });
});

describe('demo calendar', () => {
  it('has a full schedule on any day, in the display zone', () => {
    const nowMs = parseNowOverride('2026-11-01T12:00', LA)!;
    const w = windowFor(nowMs, LA);
    const events = buildEvents(expandCalendar(demoCalendar(LA), { timezone: LA, window: w }), w, LA);
    const today = events.filter((e) => e.start.startsWith('2026-11-01'));
    expect(today[0]).toMatchObject({ title: 'Trash day', allDay: true });
    expect(today.find((e) => e.title === 'Doctor: Dr. Lee')).toMatchObject({
      start: '2026-11-01T11:00:00-08:00',
      location: '123 Main St',
      note: 'Bring insurance card',
    });
    expect(today.length).toBe(8);
  });
});
