# Today display

A full-screen web page that shows what day and time it is, and what is on the
calendar today. It is meant for an older person who forgets the day or the
time. It runs unattended on a Raspberry Pi with a monitor, or on an iPad.
Family members edit the calendar in Google Calendar from anywhere; nobody
touches the screen.

```
Google Calendar (secret iCal address)
        |
        v
/api/events on Vercel      fetches the feed, expands repeating events,
        |                  returns today and the next few days as JSON
        v   every 2 minutes
/d/<token>                 the display page: clock, Next card, Today list
     ^              ^
Raspberry Pi      iPad
```

The server fetches the calendar for two reasons: Google's iCal feed does not
allow browsers to fetch it directly, and the secret address must never reach
the screen device.

## What the screen shows

- **Clock block:** day of the week, part of day (Morning, Afternoon, Evening,
  Night), the time, and the date.
- **Next card:** the most relevant event, labelled by how close it is:

  | Label | When | Timing text |
  |---|---|---|
  | Now | an event is in progress | "until 4:30 PM" |
  | Soon | the next event starts within 30 minutes | "in 20 minutes" |
  | Coming up | the next event starts within 2 hours | "in 1 hour 15 minutes" |
  | Next | the next event is later today | "at 6:00 PM" |
  | Nothing else today | no timed events are left | |

  During an event, a line such as "Then: Lunch, in 20 minutes" appears if the
  next event starts within the Soon window.
- **Today list:** all-day events in one row, then timed events in order.
  Past events are dimmed and labelled "Earlier" (not "Done", since she may
  not have gone). If the list does not fit, the earliest past events collapse
  into one "2 earlier" line, and then later events into "+3 more later".
- **Coming days:** under today's list, a heading per day ("Tomorrow,
  Thursday", then "Friday") with that day's events in a quieter style. Each
  event is listed under the day it starts. How many days is set by
  `DAYS_AHEAD` (default 2). Today always comes first: coming days only use the
  rows today's events leave free, and a day that does not fit ends with
  "+2 more", or is left out. Days with nothing on them are skipped.

At night (9 PM to 6 AM by default) all colours dim. If the calendar has not
updated for 15 minutes, a small line at the bottom says "Calendar last updated
3:05 PM". The screen never shows errors.

## For whoever edits the calendar

- Use short, plain titles: "Doctor: Dr. Lee", "Lunch with Brian".
- Put the address in the Location field.
- The first line of the Description appears on the Next card. Use it for one
  instruction, such as "Bring insurance card".
- Use all-day events for whole-day reminders, such as "Trash day".

Changes reach the screen within a few minutes, but see "How fast edits show
up" below.

## Set up

### 1. Get the calendar's secret address

In Google Calendar on a computer: Settings, pick the calendar under "Settings
for my calendars", go to "Integrate calendar", and copy "Secret address in
iCal format". Treat it like a password: anyone with it can read the calendar.
To show several calendars, copy each address.

### 2. Make a display token

The token is part of the screen's address and is checked on every request.
Make a random one:

```bash
openssl rand -hex 24
```

### 3. Deploy to Vercel

Link the folder to a new Vercel project (the CLI asks a few questions):

```bash
vercel link
```

Add each environment variable for Production. The command prompts for the
value, so secrets stay out of your shell history:

```bash
vercel env add CALENDAR_ICS_URLS production
```

```bash
vercel env add DISPLAY_TOKEN production
```

```bash
vercel env add DISPLAY_TIMEZONE production
```

Then deploy:

```bash
vercel deploy --prod
```

The display address is `https://<your-project>.vercel.app/d/<DISPLAY_TOKEN>`.
Open it with `?demo=1` added first to check that everything works.

`vercel.json` sets the framework to Next.js. Without it, a project created
from the command line expects a static `public` folder and the deploy fails.

Environment variable changes only take effect on the next deployment. To
rebuild the current production code with the new values, without uploading
anything from your folder:

```bash
vercel redeploy simple-day-sigma.vercel.app --target production
```

**This project's deployment:** Vercel project `simple-day`, production
address `https://simple-day-sigma.vercel.app`. `DISPLAY_TOKEN` and
`DISPLAY_TIMEZONE` (America/Los_Angeles) are set for Production. The full
display address, with its token, is in `.env.production.local` (git-ignored).

### 4. Set up the screens

- Raspberry Pi: [pi/README.md](pi/README.md)
- iPad: [ipad/README.md](ipad/README.md)

## Environment variables

All are read and checked in [lib/config.ts](lib/config.ts). If one is wrong,
the server logs every problem at once and the display page returns 404.

| Variable | Example | Required | Notes |
|---|---|---|---|
| `CALENDAR_ICS_URLS` | `https://calendar.google.com/calendar/ical/.../basic.ics` | yes | One or more secret iCal addresses, separated by commas. Server only. `webcal://` addresses work too. |
| `DISPLAY_TOKEN` | 48 random hex characters | yes | At least 32 characters. Needed to view the page or call the API. |
| `DISPLAY_TIMEZONE` | `America/Los_Angeles` | yes | IANA time zone of the screen. "Today" is worked out in this zone. No default, because a wrong guess would show the wrong day. |
| `DISPLAY_LOCALE` | `en-US` | no | Date and time format. 12- or 24-hour follows the locale. Default `en-US`. |
| `UPCOMING_WINDOW_MINUTES` | `120` | no | Threshold for "Coming up". Default 120. |
| `SOON_WINDOW_MINUTES` | `30` | no | Threshold for "Soon" and the "Then:" line. Default 30. |
| `NIGHT_START` / `NIGHT_END` | `21:00` / `06:00` | no | Night mode hours, 24-hour clock. Set both the same to turn night mode off. |
| `THEME` | `dark` | no | `dark` or `light`. Default `dark`. |
| `DAYS_AHEAD` | `2` | no | How many days after today to list under today's events, 0 to 6. `0` turns the coming days off. Default 2. |

All on-screen words live in [lib/strings.ts](lib/strings.ts). To translate the
display, change that file and set `DISPLAY_LOCALE`.

## How fast edits show up

The server fetches each feed at most once a minute, and the screen asks the
server every 2 minutes. So once Google publishes a change in the iCal feed,
it reaches the screen within about 3 minutes.

**Measured once, 2026-10-14:** a new event added in Google Calendar at about
8:03:30 PM was in the live API's response at 8:03:45 PM, under 30 seconds
later. The poll before, at 8:03:15 PM, did not have it. With the screen's
2-minute refresh, it would reach the display within about 2.5 minutes.

That is one test. Google does not promise how fast the secret iCal feed
updates, and it is often reported to lag. If edits regularly take more than
10 minutes, switch to the Google Calendar API as described in the build
plan's "Fallback" section. The API response shape stays the same, so the
display page needs no change.

## Working with no internet

- **While the page is open,** the clock keeps running and the last events
  stay on screen. The page keeps the last `/api/events` answer in
  localStorage and shows "Calendar last updated" when it is over 15 minutes
  old.
- **Starting with no internet** (a reload, or a Pi that reboots during an
  outage) needs a saved copy of the page. The page installs a service worker
  (`/sw.js`, code in [lib/offline.ts](lib/offline.ts)) that keeps one. On
  every page load the worker asks the server first, so new deploys arrive as
  usual. It shows the saved copy only when the server cannot be reached,
  answers with a server error, or takes more than 10 seconds. It does not
  handle any other request, so `/api/events` is never cached by it.
- Service workers need iOS 11.3 or newer and an https address (or
  localhost). Without one the page works the same, but cannot start offline.
- The saved copy contains the display token, as the page itself does. It
  stays in the browser's storage for the site, next to the localStorage copy
  of the events. The worker's own address has no token in it.
- To remove the worker later, serve a `/sw.js` that unregisters itself
  (`self.registration.unregister()`). Deleting the route is not enough:
  browsers keep an installed worker when its script returns 404.

## Development

```bash
npm install
```

Create `.env.local` with at least `DISPLAY_TOKEN` and `DISPLAY_TIMEZONE`
(`CALENDAR_ICS_URLS` can stay empty if you only use demo mode). Then:

```bash
npm run dev
```

Open `http://localhost:3000/d/<DISPLAY_TOKEN>?demo=1`.

Run the tests (Vitest):

```bash
npm test
```

### Debug parameters

Both need a valid token, like everything else.

- `?now=2026-10-14T15:40` pretends it is that time in `DISPLAY_TIMEZONE`.
  The clock runs on from there. The API uses the same day.
- `?demo=1` uses a built-in calendar in which every event repeats daily, so
  any day has a full schedule. Times that show each state:

  | `now=` time | Card |
  |---|---|
  | `05:30` | Next (night mode) |
  | `07:00` | Coming up |
  | `07:40` | Soon |
  | `08:10` | Now |
  | `11:50` | Now, with a "Then:" line |
  | `13:30` | Coming up, with "2 earlier" in the list |
  | `21:30` | Nothing else today (night mode) |

### Layout

```
app/
  d/[token]/route.ts     display page (plain HTML, see below)
  api/events/route.ts    events endpoint
  sw.js/route.ts         the service worker that saves the page for offline starts
  manifest.ts            web app manifest (standalone display)
  icon.tsx, apple-icon.tsx  Home Screen icons
client/
  display.ts             the display page's script
  display.css            the display page's styles
  sw.ts                  the service worker's event handlers
lib/
  config.ts              environment variables and defaults
  ics.ts                 fetch, parse, expand repeating events
  events.ts              window filter and sort; Next card and list logic
  format.ts              time, date, part of day, "in 20 minutes"
  strings.ts             all on-screen text
  tz.ts                  time zone math with Intl
  theme.ts               colours (contrast checked by a test)
  page.ts                builds the display page's HTML
  offline.ts             service worker logic: when to use the saved page
  demo.ts                the ?demo=1 calendar
fixtures/*.ics           test calendars
tests/*.test.ts
scripts/build-client.mjs bundles client/ into lib/generated/
pi/                      Raspberry Pi setup
ipad/                    iPad setup
```

### Why the display page is not a React page

The build plan lists `app/d/[token]/page.tsx`. The page is instead served by a
route handler as plain HTML with a small inlined script, for two reasons:

1. **Size.** A Next.js 16 page with a single React client component loads about
   168 KB of gzipped JavaScript (measured on this project), over the plan's
   100 KB budget. The display script is about 5 KB gzipped.
2. **Older iPads.** Next.js 16 supports Safari 16.4 and newer, and its
   framework code uses syntax that older Safari cannot parse. The display
   script is compiled for Safari 11, so iPads that stopped updating at iOS
   12 or 15 can still run it.

The rest of the architecture is as planned: Next.js on Vercel, the same
`/api/events` endpoint, and a client-side clock and state logic. The logic
lives in `lib/` and is unit tested; `client/display.ts` only draws it.

### Calendar parsing

`ical.js` expands repeating rules. Time zones, `UNTIL`, `EXDATE` and moved or
cancelled instances (`RECURRENCE-ID`) are handled in `lib/ics.ts` using the
browser-standard `Intl` time zone data. ical.js alone only understands zones
that the feed defines in full. The fixture tests cover: a single event, an
all-day event, weekly repeats, a moved instance, a deleted instance, cancelled
events, other time zones (including Outlook-style zone names), multi-day
events, events crossing midnight, and the 2026-11-01 daylight saving change in
Los Angeles.

## Status

| Phase | State |
|---|---|
| 1. Calendar data | Done and tested against fixture calendars. **Not yet checked against the real calendar.** |
| 2. Display page | Done. Every state checked with `?demo=1&now=…` at 1920×1080, 1280×720, and iPad sizes (1024×768, 1180×820, 1366×1024 and their portrait versions): no scrolling or clipping. Coming days (added 2026-10-14) checked at the same sizes at five times of day with a test calendar of a light week. Checked in desktop Chromium only, not on an iPad or a Pi. |
| 3. Deploy | Deployed to `https://simple-day-sigma.vercel.app` on 2026-10-14. Checked live: demo page 200, wrong token 404, API without token 401, manifest and icon 200. The real calendar is connected and returns events. One timed edit reached the API in under 30 seconds (see "How fast edits show up"). Redeployed the same evening with coming days and the offline service worker: the live page shows real events for today, tomorrow and Friday, and after a reload the service worker controls the page and has saved a copy. |
| 4. Devices | Setup files written. **Not tested on hardware.** |

### Open items

- Which calendars to include (`CALENDAR_ICS_URLS`).
- The iPad model and iOS version. iOS 11 and newer should work; iOS 9 and
  older will not.
- Display language. Change `lib/strings.ts` and `DISPLAY_LOCALE`.
- The Pi model. Zero 2 W is assumed.
