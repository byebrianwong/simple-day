import { describe, expect, it } from 'vitest';
import { addDays, dateKeyAt, isoAt, parseNowOverride, startOfDayMs, wallAt, wallToMs } from '@/lib/tz';

const LA = 'America/Los_Angeles';

describe('wallToMs and isoAt', () => {
  it('round-trips ordinary times', () => {
    const ms = wallToMs({ y: 2026, m: 10, d: 14, h: 15, mi: 40, s: 0 }, LA);
    expect(isoAt(ms, LA)).toBe('2026-10-14T15:40:00-07:00');
    expect(wallAt(ms, LA)).toEqual({ y: 2026, m: 10, d: 14, h: 15, mi: 40, s: 0 });
  });

  it('writes midnight as hour 0', () => {
    const ms = wallToMs({ y: 2026, m: 10, d: 15, h: 0, mi: 0, s: 0 }, LA);
    expect(isoAt(ms, LA)).toBe('2026-10-15T00:00:00-07:00');
  });

  it('handles zones with half-hour and positive offsets', () => {
    const ms = wallToMs({ y: 2026, m: 10, d: 14, h: 9, mi: 0, s: 0 }, 'Asia/Kolkata');
    expect(new Date(ms).toISOString()).toBe('2026-10-14T03:30:00.000Z');
    expect(isoAt(ms, 'Asia/Kolkata')).toBe('2026-10-14T09:00:00+05:30');
  });
});

describe('dates', () => {
  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('finds the start of a day in the zone', () => {
    expect(new Date(startOfDayMs('2026-10-14', LA)).toISOString()).toBe('2026-10-14T07:00:00.000Z');
    expect(dateKeyAt(Date.parse('2026-10-15T06:59:00Z'), LA)).toBe('2026-10-14');
  });
});

describe('parseNowOverride', () => {
  it('reads wall times in the display zone', () => {
    expect(isoAt(parseNowOverride('2026-10-14T15:40', LA)!, LA)).toBe('2026-10-14T15:40:00-07:00');
    expect(isoAt(parseNowOverride('2026-10-14', LA)!, LA)).toBe('2026-10-14T00:00:00-07:00');
  });

  it('reads exact instants', () => {
    expect(parseNowOverride('2026-10-14T22:40:00Z', LA)).toBe(Date.parse('2026-10-14T22:40:00Z'));
    expect(parseNowOverride('2026-10-14T15:40:00-07:00', LA)).toBe(Date.parse('2026-10-14T22:40:00Z'));
  });

  it('rejects nonsense', () => {
    expect(parseNowOverride('tomorrow', LA)).toBeNull();
    expect(parseNowOverride('', LA)).toBeNull();
    expect(parseNowOverride(null, LA)).toBeNull();
  });
});
