// The service worker's logic, kept apart from its event wiring
// (client/sw.ts) so it can be tested in Node.
//
// The worker saves a copy of the display page (one HTML document with the
// script and styles inlined) so the page can start with no internet, for
// example when a Raspberry Pi reboots during a Wi-Fi outage. It always asks
// the server first, so new deploys still arrive, and uses the saved copy only
// when the server cannot be reached. It does not save /api/events answers:
// the page keeps the last one in localStorage.
//
// The page address contains the display token. The saved copy is keyed by
// that address, in the browser's storage for this site, next to the page's
// own localStorage. Nothing here logs an address or sends it anywhere.

export const CACHE_NAME = 'today-display-pages-v1';
const CACHE_PREFIX = 'today-display-';
/** How long to wait for the server before showing the saved copy. */
export const NETWORK_TIMEOUT_MS = 10 * 1000;
/** Most pages kept. A device normally shows one (two with ?demo=1). */
export const MAX_PAGES = 4;

export type PageCache = Pick<Cache, 'match' | 'put' | 'keys' | 'delete'>;

export type Deps = {
  fetch: (input: Request | string) => Promise<Response>;
  openCache: () => Promise<PageCache>;
  setTimeout: (fn: () => void, ms: number) => unknown;
};

function noop(): void {}

/** The address without its #fragment, used as the cache key. */
function pageKey(url: string): string {
  const hash = url.indexOf('#');
  return hash < 0 ? url : url.slice(0, hash);
}

/** True for a display page address on this origin: /d/<token>, with any query. */
export function isPageUrl(url: string, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch (e) {
    return false;
  }
  return u.origin === origin && /^\/d\/[^/]+$/.test(u.pathname);
}

/** True when the browser is opening a display page (not fetching data from one). */
export function isPageRequest(request: { method: string; mode: string; url: string }, origin: string): boolean {
  return request.method === 'GET' && request.mode === 'navigate' && isPageUrl(request.url, origin);
}

/** Only a complete page is worth saving: not an error, a redirect or something else. */
export function isSavable(res: Response): boolean {
  const type = res.headers.get('content-type') || '';
  return res.status === 200 && !res.redirected && type.indexOf('text/html') === 0;
}

/** Saves a page, then drops the oldest others if there are more than MAX_PAGES. */
export function savePage(cache: PageCache, url: string, res: Response): Promise<void> {
  const key = pageKey(url);
  return cache
    .put(key, res)
    .then(function () {
      return cache.keys();
    })
    .then(function (keys) {
      // keys() lists the most recently saved last.
      let extra = keys.length - MAX_PAGES;
      const deletions: Promise<boolean>[] = [];
      for (let i = 0; i < keys.length && extra > 0; i++) {
        if (keys[i].url === key) continue;
        deletions.push(cache.delete(keys[i]));
        extra--;
      }
      return Promise.all(deletions).then(noop);
    });
}

function savedCopy(url: string, deps: Deps): Promise<Response | undefined> {
  return deps
    .openCache()
    .then(function (cache) {
      return cache.match(pageKey(url), { ignoreVary: true });
    })
    .catch(function () {
      return undefined;
    });
}

/**
 * Answers a request for the display page. Asks the server first and saves a
 * good answer. Uses the saved copy when the server cannot be reached, answers
 * with a server error (5xx), or takes longer than NETWORK_TIMEOUT_MS. Any
 * other answer, such as 404 for a wrong token, goes to the page as it is.
 *
 * `saved` settles when the save is finished; the worker passes it to
 * event.waitUntil so the browser does not stop the worker before then.
 */
export function pageResponse(
  request: Request,
  deps: Deps,
  timeoutMs: number = NETWORK_TIMEOUT_MS,
): { response: Promise<Response>; saved: Promise<void> } {
  const url = request.url;
  let save: Promise<void> = Promise.resolve();
  let answered = false;

  const response = new Promise<Response>(function (resolve, reject) {
    function answer(res: Response): void {
      answered = true;
      resolve(res);
    }

    deps.setTimeout(function () {
      if (answered) return;
      savedCopy(url, deps).then(function (copy) {
        if (copy) answer(copy);
      });
    }, timeoutMs);

    save = deps.fetch(request).then(
      function (res) {
        let saving: Promise<void> = Promise.resolve();
        if (isSavable(res)) {
          const copy = res.clone();
          saving = deps.openCache().then(function (cache) {
            return savePage(cache, url, copy);
          });
        }
        if (res.status < 500) {
          answer(res);
        } else {
          savedCopy(url, deps).then(function (copy) {
            answer(copy || res);
          });
        }
        return saving;
      },
      function (err) {
        savedCopy(url, deps).then(function (copy) {
          if (copy) answer(copy);
          else reject(err);
        });
      },
    );
  });

  return { response: response, saved: save.catch(noop) };
}

/** Fetches a page and saves it. Used for a page that was opened before the worker was installed. */
export function fetchAndSavePage(url: string, deps: Deps): Promise<void> {
  return deps
    .fetch(pageKey(url))
    .then(function (res) {
      if (!isSavable(res)) return;
      return deps.openCache().then(function (cache) {
        return savePage(cache, url, res);
      });
    })
    .catch(noop);
}

/** Caches made by older versions of this worker, to delete. */
export function staleCacheNames(names: string[]): string[] {
  return names.filter(function (name) {
    return name.indexOf(CACHE_PREFIX) === 0 && name !== CACHE_NAME;
  });
}
