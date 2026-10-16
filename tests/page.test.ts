import { beforeAll, describe, expect, it } from 'vitest';

const TOKEN = 'page-token-0123456789abcdefghijklmnopq';

beforeAll(() => {
  process.env.DISPLAY_TOKEN = TOKEN;
  process.env.DISPLAY_TIMEZONE = 'America/Los_Angeles';
  process.env.CALENDAR_ICS_URLS = 'https://calendar.example.test/secret-address/basic.ics';
  // A name with HTML in it must not be able to end the script element early.
  process.env.DISPLAY_NAME = 'Dorothy </script><b>';
});

async function get(token: string, query = '') {
  const { GET } = await import('@/app/d/[token]/route');
  return GET(new Request(`https://display.test/d/${token}${query}`), { params: Promise.resolve({ token }) });
}

describe('GET /d/[token]', () => {
  it('returns 404 for a wrong token', async () => {
    const res = await get('nope');
    expect(res.status).toBe(404);
  });

  it('serves the page with noindex, the web app tags and no secrets', async () => {
    const res = await get(TOKEN, '?demo=1&now=2026-10-14T15:40');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest">');
    expect(html).toContain('"demo":true');
    expect(html).toContain('"now":"2026-10-14T15:40"');
    expect(html).not.toContain('secret-address');
  });

  it('embeds the name safely', async () => {
    const html = await (await get(TOKEN)).text();
    expect(html).toContain('"name":"Dorothy \\u003c/script>\\u003cb>"');
    expect(html).not.toContain('Dorothy </script>');
  });
});
