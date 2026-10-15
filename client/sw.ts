// The display page's service worker. Served at /sw.js and registered by
// client/display.ts for the /d/ scope. Built by scripts/build-client.mjs.
// The logic is in lib/offline.ts; this file connects it to the worker's events.
//
// Only opening a display page goes through the worker. Every other request,
// including /api/events, the icons and the manifest, goes to the network as
// if there were no worker.

import { CACHE_NAME, isPageRequest, pageResponse, staleCacheNames, type Deps } from '../lib/offline';

// TypeScript's "dom" library has no service worker types, and adding the
// "webworker" library clashes with it, so these are the few parts used here.
type ExtendableEvent = Event & { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = ExtendableEvent & { request: Request; respondWith(response: Promise<Response>): void };
type WorkerScope = {
  location: { origin: string };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
};

const worker = self as unknown as WorkerScope;
const origin = worker.location.origin;

const deps: Deps = {
  fetch: function (input) {
    return fetch(input);
  },
  openCache: function () {
    return caches.open(CACHE_NAME);
  },
  setTimeout: function (fn, ms) {
    return setTimeout(fn, ms);
  },
};

worker.addEventListener('install', function (event) {
  // Take over from an older version straight away. Safe because the worker
  // only answers page loads; pages already open keep running as they are.
  event.waitUntil(worker.skipWaiting());
});

worker.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        staleCacheNames(names).map(function (name) {
          return caches.delete(name);
        }),
      );
    }),
  );
});

worker.addEventListener('fetch', function (event) {
  if (!isPageRequest(event.request, origin)) return;
  const answer = pageResponse(event.request, deps);
  event.respondWith(answer.response);
  event.waitUntil(answer.saved);
});
