// Every piece of text the display shows. To translate the display, change
// this file (and set DISPLAY_LOCALE so dates and times follow the language).
// Times arrive already formatted, for example "4:30 PM".

export const strings = {
  partOfDay: {
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    night: 'Night',
  },

  // Shown in place of the part of day when DISPLAY_NAME is set.
  greeting: {
    morning: (name: string) => `Good Morning, ${name}`,
    afternoon: (name: string) => `Good Afternoon, ${name}`,
    evening: (name: string) => `Good Evening, ${name}`,
    night: (name: string) => `Good Night, ${name}`,
  },

  // Next card labels.
  now: 'Now',
  soon: 'Soon',
  comingUp: 'Coming up',
  next: 'Next',
  nothingElseToday: 'Nothing else today',

  // Today list.
  allDay: 'All day',
  earlier: 'Earlier',
  earlierCount: (n: number) => `${n} earlier`,
  moreLater: (n: number) => `+${n} more later`,

  // Coming days, listed under today.
  tomorrow: (weekday: string) => `Tomorrow, ${weekday}`,
  moreOnDay: (n: number) => `+${n} more`,
  eventCount: (n: number) => (n === 1 ? '1 event' : `${n} events`),

  /** Shown when an event has no title. */
  untitled: 'Event',

  // Timing.
  startingNow: 'starting now',
  inMinutes: (n: number) => (n === 1 ? 'in 1 minute' : `in ${n} minutes`),
  inHours: (hours: number, minutes: number) => {
    const h = hours === 1 ? '1 hour' : `${hours} hours`;
    return minutes === 0 ? `in ${h}` : `in ${h} ${minutes} minutes`;
  },
  at: (time: string) => `at ${time}`,
  until: (time: string) => `until ${time}`,
  untilTomorrow: (time: string) => `until ${time} tomorrow`,
  untilDay: (weekday: string, time: string) => `until ${weekday} at ${time}`,
  startedAt: (time: string) => `started at ${time}`,
  then: (title: string, timing: string) => `Then: ${title}, ${timing}`,

  lastUpdated: (time: string) => `Calendar last updated ${time}`,
};

export type Strings = typeof strings;
