// The display page's service worker (client/sw.ts). It holds no secrets, so
// it needs no token. Its address has no token either: browsers show and log
// service worker addresses (for example in chrome://serviceworker-internals).

import { SW_JS } from '@/lib/generated/sw-asset';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  return new Response(SW_JS, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      // Browsers check this file for a new version on page loads; never let a
      // cache answer for it.
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
