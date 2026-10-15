// The display page. Served as a hand-built HTML document instead of a React
// page; see lib/page.ts for why.

import { tokenMatches } from '@/lib/auth';
import { ConfigError, displayConfig, getConfig } from '@/lib/config';
import { renderDisplayPage } from '@/lib/page';

export const dynamic = 'force-dynamic';

const COMMON_HEADERS = {
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
};

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { ...COMMON_HEADERS, 'content-type': 'text/plain' } });
}

export async function GET(request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : err);
    return notFound();
  }
  const { token } = await ctx.params;
  if (!tokenMatches(token, config.displayToken)) return notFound();

  const params = new URL(request.url).searchParams;
  const html = renderDisplayPage({
    token,
    config: displayConfig(config),
    now: params.get('now'),
    demo: params.get('demo') === '1',
  });
  return new Response(html, { headers: { ...COMMON_HEADERS, 'content-type': 'text/html; charset=utf-8' } });
}

// The page checks it is reachable with a HEAD request before its daily reload.
export async function HEAD(request: Request, ctx: { params: Promise<{ token: string }> }): Promise<Response> {
  const res = await GET(request, ctx);
  return new Response(null, { status: res.status, headers: res.headers });
}
