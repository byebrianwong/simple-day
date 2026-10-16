import { describe, expect, it } from 'vitest';
import type { DisplayConfig } from '@/lib/config';
import { buildView, planFullList, planList, windowFor, type CalendarEvent } from '@/lib/events';
import { isNight, partOfDay, relativeTiming, splitTime } from '@/lib/format';
import { parseNowOverride } from '@/lib/tz';

const LA = 'America/Los_Angeles';
const config: DisplayConfig = {
  timezone: LA,
  locale: 'en-US',
  upcomingWindowMinutes: 120,
  soonWindowMinutes: 30,
  nightStartMinute: 21 * 60,
  nightEndMinute: 6 * 60,
  theme: 'dark',
  daysAhead: 0,
  name: '',
};

function timed(id: string, title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title, start: `${start}-07:00`, end: `${end}-07:00`, allDay: false, ...extra };
}

const day: CalendarEvent[] = [
  { id: 'trash', title: 'Trash day', start: '2026-10-14', end: '2026-10-15', allDay: true },
  timed('a', 'Breakfast', '2026-10-14T08:00:00', '2026-10-14T08:30:00'),
  timed('b', 'Doctor: Dr. Lee', '2026-10-14T10:30:00', '2026-10-14T11:30:00', {
    location: '123 Main St',
    note: 'Bring insurance card',
  }),
  timed('e', 'Pills', '2026-10-14T11:15:00', '2026-10-14T11:20:00'),
  timed('c', 'Lunch', '2026-10-14T12:30:00', '2026-10-14T13:30:00'),
  timed('d', 'Dinner', '2026-10-14T18:00:00', '2026-10-14T19:00:00'),
  { id: 'tomorrow', title: 'Tomorrow', start: '2026-10-15', end: '2026-10-16', allDay: true },
  timed('t', 'Tomorrow morning', '2026-10-15T09:00:00', '2026-10-15T10:00:00'),
];

function at(time: string, events = day) {
  return buildView(events, parseNowOverride('2026-10-14T' + time, LA)!, config);
}

describe('Next card state', () => {
  it.each([
    ['07:00', 'comingUp', 'Coming up', 'Breakfast', 'in 1 hour', 'at 8:00 AM'],
    ['07:40', 'soon', 'Soon', 'Breakfast', 'in 20 minutes', 'at 8:00 AM'],
    ['07:59', 'soon', 'Soon', 'Breakfast', 'in 1 minute', 'at 8:00 AM'],
    ['08:00', 'now', 'Now', 'Breakfast', 'until 8:30 AM', 'started at 8:00 AM'],
    ['10:00', 'soon', 'Soon', 'Doctor: Dr. Lee', 'in 30 minutes', 'at 10:30 AM'],
    ['08:30', 'comingUp', 'Coming up', 'Doctor: Dr. Lee', 'in 2 hours', 'at 10:30 AM'],
    ['08:29', 'now', 'Now', 'Breakfast', 'until 8:30 AM', 'started at 8:00 AM'],
    ['14:00', 'later', 'Next', 'Dinner', 'at 6:00 PM', undefined],
    ['15:59', 'later', 'Next', 'Dinner', 'at 6:00 PM', undefined],
    ['16:00', 'comingUp', 'Coming up', 'Dinner', 'in 2 hours', 'at 6:00 PM'],
    ['19:30', 'done', 'Nothing else today', undefined, undefined, undefined],
  ])('at %s the card is %s', (time, state, label, title, timing, detail) => {
    const { card } = at(time);
    expect(card.state).toBe(state);
    expect(card.label).toBe(label);
    expect(card.title).toBe(title);
    expect(card.timing).toBe(timing);
    expect(card.detail).toBe(detail);
  });

  it('shows location and note', () => {
    expect(at('10:10').card).toMatchObject({ location: '123 Main St', note: 'Bring insurance card' });
  });

  it('adds a "Then" line when the next event starts within the Soon window', () => {
    const { card } = at('11:00');
    expect(card.state).toBe('now');
    expect(card.title).toBe('Doctor: Dr. Lee');
    expect(card.then).toBe('Then: Pills, in 15 minutes');
  });

  it('leaves out the "Then" line when the next event is further away', () => {
    expect(at('08:10').card.then).toBeUndefined();
  });

  it('prefers the most recently started of two overlapping events', () => {
    const { card } = at('11:16');
    expect(card.title).toBe('Pills');
    expect(card.timing).toBe('until 11:20 AM');
  });

  it('names the day when an event in progress ends tomorrow', () => {
    const late = [timed('x', 'Late show', '2026-10-14T23:00:00', '2026-10-15T01:00:00')];
    expect(at('23:30', late).card.timing).toBe('until 1:00 AM tomorrow');
  });

  it('handles an event that started yesterday', () => {
    const overnight = [timed('x', 'Overnight', '2026-10-13T23:00:00', '2026-10-14T01:00:00')];
    expect(at('00:30', overnight).card).toMatchObject({ state: 'now', timing: 'until 1:00 AM', detail: undefined });
  });

  it('marks an overlapping event "Now" in the list, with "until" for one that started yesterday', () => {
    const both = [
      timed('x', 'Overnight', '2026-10-13T23:00:00', '2026-10-14T01:00:00'),
      timed('y', 'Night nurse', '2026-10-14T00:15:00', '2026-10-14T00:45:00'),
    ];
    const v = at('00:30', both);
    expect(v.card.title).toBe('Night nurse');
    expect(v.current.map((r) => [r.time, r.title, r.status])).toEqual([['until 1:00 AM', 'Overnight', 'now']]);
  });

  it('treats a timed event covering the whole day as all-day', () => {
    const stay = [timed('x', 'Hospital stay', '2026-10-12T09:00:00', '2026-10-16T17:00:00')];
    const v = at('12:00', stay);
    expect(v.allDay).toEqual([{ title: 'Hospital stay', icon: 'stethoscope' }]);
    expect(v.card.state).toBe('done');
  });

  it('shows "Now" for the first minute of an event with no length', () => {
    const reminder = [timed('x', 'Take pills', '2026-10-14T09:00:00', '2026-10-14T09:00:00')];
    expect(at('09:00', reminder).card.state).toBe('now');
    expect(at('09:01', reminder).card.state).toBe('done');
  });

  it('uses a placeholder for an event without a title', () => {
    expect(at('09:30', [timed('x', '', '2026-10-14T10:00:00', '2026-10-14T11:00:00')]).card.title).toBe('Event');
  });
});

describe('Today list', () => {
  it('splits past events from the rest, leaving out what the Next card shows', () => {
    // At 11:00 the card shows the doctor (Now) and "Then: Pills".
    const v = at('11:00');
    expect(v.allDay).toEqual([{ title: 'Trash day', icon: 'trash-2' }]);
    expect(v.past.map((r) => [r.time, r.title, r.status])).toEqual([['8:00 AM', 'Breakfast', 'past']]);
    expect(v.current.map((r) => [r.time, r.title, r.status])).toEqual([
      ['12:30 PM', 'Lunch', 'upcoming'],
      ['6:00 PM', 'Dinner', 'upcoming'],
    ]);
  });

  it.each([
    ['07:40', 'Breakfast'],
    ['14:00', 'Dinner'],
    ['16:00', 'Dinner'],
  ])('at %s does not repeat the card event (%s) in the list', (time, title) => {
    const v = at(time);
    expect(v.card.title).toBe(title);
    expect(v.current.map((r) => r.title)).not.toContain(title);
  });

  it('keeps everything in the list once nothing is left for the card', () => {
    expect(at('19:30').past.map((r) => r.title)).toEqual(['Breakfast', 'Doctor: Dr. Lee', 'Pills', 'Lunch', 'Dinner']);
  });

  it('leaves out tomorrow', () => {
    const v = at('19:30');
    expect(v.allDay.map((a) => a.title)).toEqual(['Trash day']);
    expect([...v.past, ...v.current].map((r) => r.title)).not.toContain('Tomorrow morning');
  });
});

describe('planList (overflow)', () => {
  const plan = (hiddenPast: number, earlierLine: boolean, shownCurrent: number, moreLater: number) => ({
    hiddenPast,
    earlierLine,
    shownCurrent,
    moreLater,
  });

  it('shows everything when it fits', () => {
    expect(planList(2, 3, true, 6)).toEqual(plan(0, false, 3, 0));
  });

  it('hides the earliest past events first, behind one line', () => {
    // All-day row + "2 earlier" + 1 past + 3 current = 6 rows.
    expect(planList(3, 3, true, 6)).toEqual(plan(2, true, 3, 0));
  });

  it('then cuts upcoming events and ends with "+N more later"', () => {
    // "3 earlier" + 3 current + "+3 more later" = 5 rows.
    expect(planList(3, 6, false, 5)).toEqual(plan(3, true, 3, 3));
    expect(planList(0, 8, false, 5)).toEqual(plan(0, false, 4, 4));
  });

  it('shows a single past event instead of "1 earlier", which takes the same room', () => {
    expect(planList(1, 3, false, 3)).toEqual(plan(0, false, 1, 2));
    expect(planList(1, 6, false, 4)).toEqual(plan(0, false, 2, 4));
  });

  it('drops past events entirely rather than push out the event in progress', () => {
    // All-day + "Now" + "+5 more later", instead of all-day + past + "+6 more later".
    expect(planList(1, 6, true, 3)).toEqual(plan(1, false, 1, 5));
    expect(planList(4, 6, false, 2)).toEqual(plan(4, false, 1, 5));
  });

  it('never returns negative counts on a tiny screen', () => {
    expect(planList(0, 3, false, 1)).toEqual(plan(0, false, 0, 3));
    expect(planList(2, 3, true, 0)).toEqual(plan(2, false, 0, 3));
  });

  it('keeps the latest past event when nothing is current', () => {
    // All-day + "4 earlier" + the last past event.
    expect(planList(5, 0, true, 3)).toEqual(plan(4, true, 0, 0));
  });
});

describe('part of day', () => {
  it.each([
    ['0:00', 'night'],
    ['4:59', 'night'],
    ['5:00', 'morning'],
    ['11:59', 'morning'],
    ['12:00', 'afternoon'],
    ['16:59', 'afternoon'],
    ['17:00', 'evening'],
    ['20:59', 'evening'],
    ['21:00', 'night'],
    ['23:59', 'night'],
  ])('%s is %s', (clock, expected) => {
    const [h, m] = clock.split(':').map(Number);
    expect(partOfDay(h * 60 + m)).toBe(expected);
  });

  it('appears in the view', () => {
    expect(at('15:42').partOfDay).toBe('Afternoon');
  });
});

describe('relative timing wording', () => {
  it.each([
    [0, 'starting now'],
    [1, 'in 1 minute'],
    [2, 'in 2 minutes'],
    [59, 'in 59 minutes'],
    [60, 'in 1 hour'],
    [62, 'in 1 hour'],
    [63, 'in 1 hour 5 minutes'],
    [75, 'in 1 hour 15 minutes'],
    [118, 'in 2 hours'],
    [120, 'in 2 hours'],
    [135, 'in 2 hours 15 minutes'],
  ])('%i minutes reads "%s"', (minutes, text) => {
    expect(relativeTiming(minutes)).toBe(text);
  });
});

describe('night mode', () => {
  it('wraps past midnight', () => {
    expect(isNight(20 * 60 + 59, 21 * 60, 6 * 60)).toBe(false);
    expect(isNight(21 * 60, 21 * 60, 6 * 60)).toBe(true);
    expect(isNight(5 * 60 + 59, 21 * 60, 6 * 60)).toBe(true);
    expect(isNight(6 * 60, 21 * 60, 6 * 60)).toBe(false);
  });

  it('is off when start equals end', () => {
    expect(isNight(0, 0, 0)).toBe(false);
  });

  it('appears in the view', () => {
    expect(at('21:00').night).toBe(true);
    expect(at('20:59').night).toBe(false);
  });
});

describe('clock text', () => {
  it('splits the AM/PM marker from the digits', () => {
    const ms = parseNowOverride('2026-10-14T15:42', LA)!;
    expect(splitTime(ms, LA, 'en-US')).toEqual({ clock: '3:42', period: 'PM', periodFirst: false });
    expect(splitTime(ms, LA, 'de-DE')).toEqual({ clock: '15:42', period: '', periodFirst: false });
  });

  it('builds the clock block', () => {
    const v = at('15:42');
    expect([v.weekday, v.partOfDay, v.clock, v.period, v.date]).toEqual([
      'Wednesday',
      'Afternoon',
      '3:42',
      'PM',
      'October 14, 2026',
    ]);
  });
});

describe('coming days', () => {
  const ahead = { ...config, daysAhead: 2 };
  const events: CalendarEvent[] = [
    ...day,
    timed('late', 'Late show', '2026-10-14T23:00:00', '2026-10-15T01:00:00'),
    { id: 'visit', title: 'Susan visiting', start: '2026-10-15', end: '2026-10-18', allDay: true },
    timed('dentist', 'Dentist', '2026-10-16T14:00:00', '2026-10-16T15:00:00'),
    timed('hair', 'Haircut', '2026-10-16T09:30:00', '2026-10-16T10:00:00'),
    timed('far', 'Too far ahead', '2026-10-17T09:00:00', '2026-10-17T10:00:00'),
  ];

  it('lists each event under the day it starts, labelled by day', () => {
    const v = buildView(events, parseNowOverride('2026-10-14T19:30', LA)!, ahead);
    expect(v.days).toEqual([
      {
        label: 'Tomorrow, Thursday',
        date: 'October 15',
        allDay: [
          { title: 'Tomorrow', icon: undefined },
          { title: 'Susan visiting', icon: 'users' },
        ],
        rows: [{ id: 't', time: '9:00 AM', title: 'Tomorrow morning', icon: undefined }],
      },
      {
        label: 'Friday',
        date: 'October 16',
        allDay: [],
        rows: [
          { id: 'hair', time: '9:30 AM', title: 'Haircut', icon: 'scissors' },
          { id: 'dentist', time: '2:00 PM', title: 'Dentist', icon: 'toothbrush' },
        ],
      },
    ]);
  });

  it('is empty when DAYS_AHEAD is 0', () => {
    expect(buildView(events, parseNowOverride('2026-10-14T19:30', LA)!, config).days).toEqual([]);
  });

  it('leaves out days with nothing on them', () => {
    const v = buildView([timed('x', 'Only Friday', '2026-10-16T09:00:00', '2026-10-16T10:00:00')], parseNowOverride('2026-10-14T12:00', LA)!, ahead);
    expect(v.days.map((d) => d.label)).toEqual(['Friday']);
  });

  it('asks the API for enough days to roll over at midnight', () => {
    const w = windowFor(parseNowOverride('2026-10-14T12:00', LA)!, LA, 2);
    expect([w.startDate, w.endDate]).toEqual(['2026-10-14', '2026-10-18']);
  });
});

describe('planFullList (today first, then coming days)', () => {
  it('shows everything when it fits', () => {
    expect(planFullList(1, 2, true, [2, 1], 10)).toEqual({
      today: { hiddenPast: 0, earlierLine: false, shownCurrent: 2, moreLater: 0 },
      days: [
        { index: 0, shown: 2, more: 0 },
        { index: 1, shown: 1, more: 0 },
      ],
    });
  });

  it('gives coming days nothing while today is cut short', () => {
    expect(planFullList(0, 8, false, [2], 5).days).toEqual([]);
  });

  it('folds past events into "N earlier" to make room', () => {
    // 4 past + 1 current = 5 rows. Folding 3 gives "3 earlier" + 1 past + 1 current
    // = 3 rows, leaving 3 for "Tomorrow" + 2 events.
    expect(planFullList(4, 1, false, [2], 6)).toEqual({
      today: { hiddenPast: 3, earlierLine: true, shownCurrent: 1, moreLater: 0 },
      days: [{ index: 0, shown: 2, more: 0 }],
    });
  });

  it('gives the last past row to a coming day that would be cut short', () => {
    // Evening, nothing left today: "2 earlier" + "Tomorrow" + "3 events" becomes
    // "Tomorrow" + 1 event + "+2 more".
    expect(planFullList(2, 0, false, [3, 1], 3)).toEqual({
      today: { hiddenPast: 2, earlierLine: false, shownCurrent: 0, moreLater: 0 },
      days: [{ index: 0, shown: 1, more: 2 }],
    });
  });

  it('keeps the past row when coming days fit anyway', () => {
    expect(planFullList(2, 0, false, [1], 3).today).toEqual({ hiddenPast: 2, earlierLine: true, shownCurrent: 0, moreLater: 0 });
  });

  it('cuts a coming day short with a "+N more" line', () => {
    // 2 rows of today, then heading + 1 event + "+2 more".
    expect(planFullList(0, 2, false, [3, 1], 5).days).toEqual([{ index: 0, shown: 1, more: 2 }]);
  });

  it('shows just the heading and a count when only two rows are left', () => {
    expect(planFullList(0, 2, false, [3], 4).days).toEqual([{ index: 0, shown: 0, more: 3 }]);
  });

  it('leaves a day out when only its heading would fit', () => {
    expect(planFullList(0, 2, false, [3], 3).days).toEqual([]);
  });
});

describe('greeting', () => {
  const named = { ...config, name: 'Dorothy' };

  it.each([
    ['04:59', 'Good Night, Dorothy'],
    ['05:00', 'Good Morning, Dorothy'],
    ['11:59', 'Good Morning, Dorothy'],
    ['12:00', 'Good Afternoon, Dorothy'],
    ['16:59', 'Good Afternoon, Dorothy'],
    ['17:00', 'Good Evening, Dorothy'],
    ['20:59', 'Good Evening, Dorothy'],
    ['21:00', 'Good Night, Dorothy'],
  ])('at %s says "%s"', (time, text) => {
    expect(buildView([], parseNowOverride('2026-10-14T' + time, LA)!, named).partOfDay).toBe(text);
  });

  it('shows just the part of day when no name is set', () => {
    expect(at('15:42').partOfDay).toBe('Afternoon');
  });
});

describe('event pictures in the view', () => {
  it('puts the picture on the card and on list rows', () => {
    const v = at('11:00');
    expect(v.card).toMatchObject({ title: 'Doctor: Dr. Lee', icon: 'stethoscope' });
    expect(v.past[0]).toMatchObject({ title: 'Breakfast', icon: 'utensils' });
    expect(v.current.map((r) => r.icon)).toEqual(['utensils', 'utensils']);
  });

  it('leaves the picture out when no rule matches', () => {
    expect(at('09:30', [timed('x', 'Something unusual', '2026-10-14T10:00:00', '2026-10-14T11:00:00')]).card.icon).toBeUndefined();
  });
});
