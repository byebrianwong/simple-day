import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig } from '@/lib/config';

const base = { DISPLAY_TOKEN: 'x'.repeat(32), DISPLAY_TIMEZONE: 'America/Los_Angeles' };

describe('readConfig', () => {
  it('applies defaults', () => {
    expect(readConfig(base)).toEqual({
      calendarUrls: [],
      displayToken: 'x'.repeat(32),
      timezone: 'America/Los_Angeles',
      locale: 'en-US',
      upcomingWindowMinutes: 120,
      soonWindowMinutes: 30,
      nightStartMinute: 21 * 60,
      nightEndMinute: 6 * 60,
      theme: 'dark',
      daysAhead: 2,
      name: '',
    });
  });

  it('reads every variable', () => {
    const c = readConfig({
      ...base,
      CALENDAR_ICS_URLS: 'https://a.test/x.ics,https://b.test/y.ics',
      DISPLAY_LOCALE: 'en-GB',
      UPCOMING_WINDOW_MINUTES: '90',
      SOON_WINDOW_MINUTES: '15',
      NIGHT_START: '22:30',
      NIGHT_END: '7:00',
      THEME: 'light',
      DAYS_AHEAD: '3',
      DISPLAY_NAME: '  Dorothy  ',
    });
    expect(c.daysAhead).toBe(3);
    expect(c.name).toBe('Dorothy');
    expect(c.calendarUrls).toEqual(['https://a.test/x.ics', 'https://b.test/y.ics']);
    expect(c.locale).toBe('en-GB');
    expect([c.upcomingWindowMinutes, c.soonWindowMinutes]).toEqual([90, 15]);
    expect([c.nightStartMinute, c.nightEndMinute]).toEqual([22 * 60 + 30, 7 * 60]);
    expect(c.theme).toBe('light');
  });

  it('lists every problem at once without echoing secrets', () => {
    try {
      readConfig({ DISPLAY_TOKEN: 'short', DISPLAY_TIMEZONE: 'Mars/Base', THEME: 'blue', NIGHT_START: '25:00', DAYS_AHEAD: '9', DISPLAY_NAME: 'x'.repeat(41) });
      throw new Error('expected a ConfigError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as Error).message;
      expect(msg).toContain('DISPLAY_TOKEN');
      expect(msg).toContain('DISPLAY_TIMEZONE');
      expect(msg).toContain('THEME');
      expect(msg).toContain('NIGHT_START');
      expect(msg).toContain('DAYS_AHEAD');
      expect(msg).toContain('DISPLAY_NAME');
      expect(msg).not.toContain('short');
    }
  });
});
