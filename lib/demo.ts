// The calendar served for `?demo=1`. Every event repeats daily, so any day
// (including one picked with `?now=`) has a full schedule. The text goes
// through the same parser as a real feed.
//
// Times that show each Next card state with `?demo=1&now=<date>T<time>`:
//   05:30 Next (and night mode)   07:00 Coming up   07:40 Soon
//   08:10 Now                     08:45 Next        11:50 Now, with "Then:"
//   13:30 Coming up               21:30 Nothing else today (night mode)

type DemoEvent = { uid: string; start?: string; end?: string; title: string; location?: string; description?: string };

const EVENTS: DemoEvent[] = [
  { uid: 'demo-trash', title: 'Trash day' },
  { uid: 'demo-breakfast', start: '080000', end: '083000', title: 'Breakfast and morning pills', description: 'Pills are in the blue box by the sink' },
  { uid: 'demo-doctor', start: '110000', end: '120000', title: 'Doctor: Dr. Lee', location: '123 Main St', description: 'Bring insurance card<br>Susan will drive' },
  { uid: 'demo-lunch', start: '121500', end: '131500', title: 'Lunch with Brian', location: 'Corner Cafe' },
  { uid: 'demo-walk', start: '150000', end: '154500', title: 'Walk with Maria' },
  { uid: 'demo-dinner', start: '173000', end: '181500', title: 'Dinner' },
  { uid: 'demo-call', start: '190000', end: '193000', title: 'Phone call from Susan' },
  { uid: 'demo-news', start: '203000', end: '210000', title: 'Evening news' },
];

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function demoCalendar(tz: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//simple-day//demo//EN'];
  for (const e of EVENTS) {
    lines.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:20200101T000000Z');
    if (e.start && e.end) {
      lines.push(`DTSTART;TZID=${tz}:20200101T${e.start}`, `DTEND;TZID=${tz}:20200101T${e.end}`);
    } else {
      lines.push('DTSTART;VALUE=DATE:20200101', 'DTEND;VALUE=DATE:20200102');
    }
    lines.push('RRULE:FREQ=DAILY', 'SUMMARY:' + escapeText(e.title));
    if (e.location) lines.push('LOCATION:' + escapeText(e.location));
    if (e.description) lines.push('DESCRIPTION:' + escapeText(e.description));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
