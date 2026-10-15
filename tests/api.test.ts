import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const TOKEN = 'test-token-0123456789abcdefghijklmnop';

beforeAll(() => {
  process.env.DISPLAY_TOKEN = TOKEN;
  process.env.DISPLAY_TIMEZONE = 'America/Los_Angeles';
  process.env.CALENDAR_ICS_URLS = 'https://example.test/a.ics, webcal://example.test/b.ics';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function call(query: string, token: string | null = TOKEN) {
  const { GET } = await import('@/app/api/events/route');
  const headers: Record<string, string> = {};
  if (token !== null) headers['x-display-token'] = token;
  const res = await GET(new Request('https://display.test/api/events' + query, { headers }));
  return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') };
}

describe('GET /api/events', () => {
  it('rejects a missing or wrong token', async () => {
    expect((await call('?demo=1', null)).status).toBe(401);
    expect((await call('?demo=1', 'wrong')).status).toBe(401);
  });

  it('serves the demo calendar for the requested day', async () => {
    const { status, body, cache } = await call('?demo=1&now=2026-10-14T15:40');
    expect(status).toBe(200);
    expect(cache).toBe('no-store');
    expect(body.timezone).toBe('America/Los_Angeles');
    expect(body.generatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(body.events[0]).toMatchObject({ title: 'Trash day', start: '2026-10-14', end: '2026-10-15', allDay: true });
    // Today, two days ahead (DAYS_AHEAD defaults to 2) and one more for the
    // midnight rollover: 4 days of 8 demo events.
    expect(body.events.length).toBe(32);
    expect(body.events[body.events.length - 1].start).toBe('2026-10-17T20:30:00-07:00');
  });

  it('merges the configured feeds and keeps going when one fails', async () => {
    const single = readFileSync(path.join(__dirname, '..', 'fixtures', 'single.ics'), 'utf8');
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('a.ics') ? new Response(single) : new Response('nope', { status: 500 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { status, body } = await call('?now=2026-10-14T15:40');
    expect(status).toBe(200);
    expect(body.events.map((e: { title: string }) => e.title)).toEqual(['Doctor: Dr. Lee', 'Tomorrow morning']);
    // webcal:// is fetched over https.
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain('https://example.test/b.ics');
  });

  it('returns 502 when every feed fails and nothing is cached', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status } = await call('?now=2026-10-14T15:40');
    expect(status).toBe(502);
    // Logs name the feed by number, never by its secret URL.
    expect(errors.mock.calls.flat().join(' ')).not.toContain('example.test');
    errors.mockRestore();
  });
});
