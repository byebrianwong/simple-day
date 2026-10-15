import { describe, expect, it } from 'vitest';
import {
  CACHE_NAME,
  MAX_PAGES,
  fetchAndSavePage,
  isPageRequest,
  isPageUrl,
  pageResponse,
  savePage,
  staleCacheNames,
  type Deps,
  type PageCache,
} from '@/lib/offline';

const ORIGIN = 'https://display.test';
const PAGE = ORIGIN + '/d/secret-token?demo=1';

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function keyOf(req: RequestInfo | URL): string {
  return typeof req === 'string' ? req : req instanceof URL ? req.href : req.url;
}

/** An in-memory stand-in for the browser's Cache. Keeps entries in save order, like the real one. */
function memoryCache() {
  const entries = new Map<string, Response>();
  const cache = {
    async match(req: RequestInfo | URL) {
      const res = entries.get(keyOf(req));
      return res ? res.clone() : undefined;
    },
    async put(req: RequestInfo | URL, res: Response) {
      const key = keyOf(req);
      entries.delete(key);
      entries.set(key, res);
    },
    async keys() {
      return Array.from(entries.keys()).map((url) => new Request(url));
    },
    async delete(req: RequestInfo | URL) {
      return entries.delete(keyOf(req));
    },
  };
  return { cache: cache as unknown as PageCache, entries };
}

/** Builds deps whose network answers with `network()`, and whose timer fires only when `fireTimer()` is called. */
function setup(network: () => Promise<Response>) {
  const { cache, entries } = memoryCache();
  const timers: (() => void)[] = [];
  const deps: Deps = {
    fetch: () => network(),
    openCache: async () => cache,
    setTimeout: (fn) => timers.push(fn),
  };
  return {
    deps,
    cache,
    entries,
    fireTimer: () => timers.forEach((fn) => fn()),
  };
}

function navigate(url = PAGE): Request {
  // Node's Request cannot be built with mode "navigate"; the logic only reads the URL.
  return new Request(url);
}

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

describe('which requests the worker answers', () => {
  it('matches display page addresses on this origin only', () => {
    expect(isPageUrl(ORIGIN + '/d/abc', ORIGIN)).toBe(true);
    expect(isPageUrl(ORIGIN + '/d/abc?demo=1&now=2026-10-14T15:40', ORIGIN)).toBe(true);
    expect(isPageUrl(ORIGIN + '/d/', ORIGIN)).toBe(false);
    expect(isPageUrl(ORIGIN + '/d/abc/more', ORIGIN)).toBe(false);
    expect(isPageUrl(ORIGIN + '/api/events', ORIGIN)).toBe(false);
    expect(isPageUrl(ORIGIN + '/sw.js', ORIGIN)).toBe(false);
    expect(isPageUrl('https://other.test/d/abc', ORIGIN)).toBe(false);
    expect(isPageUrl('not a url', ORIGIN)).toBe(false);
  });

  it('answers only page loads, never the page fetching data', () => {
    expect(isPageRequest({ method: 'GET', mode: 'navigate', url: PAGE }, ORIGIN)).toBe(true);
    // The page's daily reload check, and its calls to /api/events.
    expect(isPageRequest({ method: 'HEAD', mode: 'cors', url: PAGE }, ORIGIN)).toBe(false);
    expect(isPageRequest({ method: 'GET', mode: 'cors', url: PAGE }, ORIGIN)).toBe(false);
    expect(isPageRequest({ method: 'GET', mode: 'cors', url: ORIGIN + '/api/events?demo=1' }, ORIGIN)).toBe(false);
    expect(isPageRequest({ method: 'GET', mode: 'navigate', url: ORIGIN + '/api/events' }, ORIGIN)).toBe(false);
  });
});

describe('opening the page', () => {
  it('online: shows the server page and saves it', async () => {
    const t = setup(async () => html('fresh'));
    const answer = pageResponse(navigate(), t.deps);
    expect(await (await answer.response).text()).toBe('fresh');
    await answer.saved;
    expect(await (await t.cache.match(PAGE))!.text()).toBe('fresh');
  });

  it('offline: shows the saved page', async () => {
    const t = setup(offline);
    await t.cache.put(PAGE, html('saved'));
    const answer = pageResponse(navigate(), t.deps);
    expect(await (await answer.response).text()).toBe('saved');
    await answer.saved;
  });

  it('offline with nothing saved: fails like a normal page load', async () => {
    const t = setup(offline);
    const answer = pageResponse(navigate(), t.deps);
    await expect(answer.response).rejects.toThrow('Failed to fetch');
    await answer.saved;
  });

  it('the saved copy is per address: ?demo=1 does not stand in for the live page', async () => {
    const t = setup(offline);
    await t.cache.put(PAGE, html('demo'));
    const answer = pageResponse(navigate(ORIGIN + '/d/secret-token'), t.deps);
    await expect(answer.response).rejects.toThrow();
  });

  it('server error (5xx): shows the saved page if there is one', async () => {
    const t = setup(async () => html('down', 503));
    await t.cache.put(PAGE, html('saved'));
    expect(await (await pageResponse(navigate(), t.deps).response).text()).toBe('saved');

    const empty = setup(async () => html('down', 503));
    expect((await pageResponse(navigate(), empty.deps).response).status).toBe(503);
  });

  it('404 (wrong token) goes to the page as it is, and is not saved', async () => {
    const t = setup(async () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } }));
    await t.cache.put(PAGE, html('saved'));
    const answer = pageResponse(navigate(), t.deps);
    expect((await answer.response).status).toBe(404);
    await answer.saved;
    expect(await (await t.cache.match(PAGE))!.text()).toBe('saved');
  });

  it('slow server: shows the saved page after the timeout, then saves the late answer', async () => {
    let arrive: (res: Response) => void = () => {};
    const t = setup(() => new Promise<Response>((resolve) => (arrive = resolve)));
    await t.cache.put(PAGE, html('saved'));
    const answer = pageResponse(navigate(), t.deps);
    t.fireTimer();
    expect(await (await answer.response).text()).toBe('saved');
    arrive(html('late'));
    await answer.saved;
    expect(await (await t.cache.match(PAGE))!.text()).toBe('late');
  });

  it('slow server with nothing saved: keeps waiting for the server', async () => {
    let arrive: (res: Response) => void = () => {};
    const t = setup(() => new Promise<Response>((resolve) => (arrive = resolve)));
    const answer = pageResponse(navigate(), t.deps);
    t.fireTimer();
    await new Promise((resolve) => setTimeout(resolve, 0));
    arrive(html('late'));
    expect(await (await answer.response).text()).toBe('late');
  });

  it('does not save redirects or anything that is not a full HTML page', async () => {
    for (const res of [
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
      html('partial', 206),
      Object.defineProperty(html('moved'), 'redirected', { value: true }),
    ]) {
      const t = setup(async () => res);
      const answer = pageResponse(navigate(), t.deps);
      await answer.response;
      await answer.saved;
      expect(t.entries.size).toBe(0);
    }
  });
});

describe('saving', () => {
  it('saves a page that was opened before the worker was installed', async () => {
    const t = setup(async () => html('first visit'));
    await fetchAndSavePage(PAGE + '#ignored', t.deps);
    expect(await (await t.cache.match(PAGE))!.text()).toBe('first visit');
  });

  it('ignores failures while saving', async () => {
    const t = setup(offline);
    await expect(fetchAndSavePage(PAGE, t.deps)).resolves.toBeUndefined();
    expect(t.entries.size).toBe(0);
  });

  it(`keeps at most ${MAX_PAGES} pages, dropping the oldest`, async () => {
    const { cache, entries } = memoryCache();
    for (let i = 1; i <= MAX_PAGES + 2; i++) await savePage(cache, `${ORIGIN}/d/t?now=${i}`, html(String(i)));
    expect(entries.size).toBe(MAX_PAGES);
    expect(Array.from(entries.keys())).toEqual([3, 4, 5, 6].map((i) => `${ORIGIN}/d/t?now=${i}`));
    // Saving an old address again makes it the newest.
    await savePage(cache, `${ORIGIN}/d/t?now=3`, html('3 again'));
    await savePage(cache, `${ORIGIN}/d/t?now=7`, html('7'));
    expect(Array.from(entries.keys())).toEqual([5, 6, 3, 7].map((i) => `${ORIGIN}/d/t?now=${i}`));
  });

  it('deletes only caches from older versions of this worker', () => {
    expect(staleCacheNames(['today-display-pages-v0', CACHE_NAME, 'something-else'])).toEqual(['today-display-pages-v0']);
  });
});

describe('GET /sw.js', () => {
  it('serves the worker as uncached JavaScript, without logging', async () => {
    const { GET } = await import('@/app/sw.js/route');
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const js = await res.text();
    expect(js).toContain(CACHE_NAME);
    // Page addresses contain the token, so the worker must never log one.
    expect(js).not.toContain('console.');
  });
});
