// Reads and checks configuration from environment variables. Server only:
// the calendar URLs and the token must never reach the browser. The display
// page receives the DisplayConfig subset, which holds no secrets.

import { isValidTimeZone } from './tz';

export type Theme = 'dark' | 'light';

export type DisplayConfig = {
  timezone: string;
  locale: string;
  upcomingWindowMinutes: number;
  soonWindowMinutes: number;
  /** Minutes since midnight. Night mode is off when start equals end. */
  nightStartMinute: number;
  nightEndMinute: number;
  theme: Theme;
  /** How many days after today to list under today's events. 0 turns it off. */
  daysAhead: number;
  /** The viewer's name for the greeting ("Good Morning, Dorothy"). Empty: no greeting. */
  name: string;
};

export type ServerConfig = DisplayConfig & {
  calendarUrls: string[];
  displayToken: string;
};

export class ConfigError extends Error {}

const MIN_TOKEN_LENGTH = 32;
const MAX_DAYS_AHEAD = 6;
const MAX_NAME_LENGTH = 40;

type Env = { [key: string]: string | undefined };

function parseMinutes(raw: string | undefined, fallback: number, name: string, problems: string[]): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n <= 0) {
    problems.push(`${name} must be a whole number of minutes greater than 0.`);
    return fallback;
  }
  return n;
}

function parseClock(raw: string | undefined, fallback: string, name: string, problems: string[]): number {
  const value = raw === undefined || raw.trim() === '' ? fallback : raw.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || +match[1] > 23 || +match[2] > 59) {
    problems.push(`${name} must be a 24-hour time such as 21:00.`);
    return 0;
  }
  return +match[1] * 60 + +match[2];
}

function parseUrls(raw: string | undefined, problems: string[]): string[] {
  if (!raw) return [];
  const urls: string[] = [];
  for (const part of raw.split(',')) {
    let url = part.trim();
    if (!url) continue;
    // Calendar apps sometimes hand out webcal:// links. They are plain HTTPS.
    if (url.startsWith('webcal://')) url = 'https://' + url.slice('webcal://'.length);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
      urls.push(url);
    } catch {
      problems.push(`CALENDAR_ICS_URLS entry ${urls.length + 1} is not a valid http(s) URL.`);
    }
  }
  return urls;
}

export function readConfig(env: Env): ServerConfig {
  const problems: string[] = [];

  const displayToken = (env.DISPLAY_TOKEN || '').trim();
  if (displayToken.length < MIN_TOKEN_LENGTH) {
    problems.push(`DISPLAY_TOKEN must be set and at least ${MIN_TOKEN_LENGTH} characters long.`);
  }

  const timezone = (env.DISPLAY_TIMEZONE || '').trim();
  if (!isValidTimeZone(timezone)) {
    problems.push('DISPLAY_TIMEZONE must be an IANA time zone such as America/Los_Angeles.');
  }

  let locale = (env.DISPLAY_LOCALE || '').trim() || 'en-US';
  try {
    locale = Intl.getCanonicalLocales(locale)[0];
  } catch {
    problems.push('DISPLAY_LOCALE must be a language tag such as en-US.');
  }

  const upcomingWindowMinutes = parseMinutes(env.UPCOMING_WINDOW_MINUTES, 120, 'UPCOMING_WINDOW_MINUTES', problems);
  const soonWindowMinutes = parseMinutes(env.SOON_WINDOW_MINUTES, 30, 'SOON_WINDOW_MINUTES', problems);
  if (soonWindowMinutes > upcomingWindowMinutes) {
    problems.push('SOON_WINDOW_MINUTES must not be larger than UPCOMING_WINDOW_MINUTES.');
  }

  const nightStartMinute = parseClock(env.NIGHT_START, '21:00', 'NIGHT_START', problems);
  const nightEndMinute = parseClock(env.NIGHT_END, '06:00', 'NIGHT_END', problems);

  const themeRaw = (env.THEME || 'dark').trim().toLowerCase();
  if (themeRaw !== 'dark' && themeRaw !== 'light') problems.push('THEME must be dark or light.');
  const theme: Theme = themeRaw === 'light' ? 'light' : 'dark';

  let daysAhead = 2;
  const daysRaw = (env.DAYS_AHEAD || '').trim();
  if (daysRaw !== '') {
    daysAhead = Number(daysRaw);
    if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead > MAX_DAYS_AHEAD) {
      problems.push(`DAYS_AHEAD must be a whole number from 0 to ${MAX_DAYS_AHEAD}.`);
      daysAhead = 2;
    }
  }

  const name = (env.DISPLAY_NAME || '').trim().replace(/\s+/g, ' ');
  if (name.length > MAX_NAME_LENGTH) {
    problems.push(`DISPLAY_NAME must be at most ${MAX_NAME_LENGTH} characters.`);
  }

  const calendarUrls = parseUrls(env.CALENDAR_ICS_URLS, problems);

  if (problems.length) {
    throw new ConfigError('Configuration problems:\n- ' + problems.join('\n- '));
  }

  return {
    calendarUrls,
    displayToken,
    timezone,
    locale,
    upcomingWindowMinutes,
    soonWindowMinutes,
    nightStartMinute,
    nightEndMinute,
    theme,
    daysAhead,
    name,
  };
}

let cached: ServerConfig | null = null;

/** The configuration for this server process. Throws ConfigError if invalid. */
export function getConfig(): ServerConfig {
  if (!cached) cached = readConfig(process.env);
  return cached;
}

export function displayConfig(c: ServerConfig): DisplayConfig {
  return {
    timezone: c.timezone,
    locale: c.locale,
    upcomingWindowMinutes: c.upcomingWindowMinutes,
    soonWindowMinutes: c.soonWindowMinutes,
    nightStartMinute: c.nightStartMinute,
    nightEndMinute: c.nightEndMinute,
    theme: c.theme,
    daysAhead: c.daysAhead,
    name: c.name,
  };
}
