import { tokenMatches } from '@/lib/auth';
import { ConfigError, getConfig } from '@/lib/config';
import { demoCalendar } from '@/lib/demo';
import { buildEvents, windowFor, type EventsResponse, type Occurrence } from '@/lib/events';
import { expandCalendar, loadCalendar } from '@/lib/ics';
import { parseNowOverride } from '@/lib/tz';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'cache-control': 'no-store' };

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    console.error(err instanceof ConfigError ? err.message : err);
    return error(500, 'Server is not configured');
  }

  if (!tokenMatches(request.headers.get('x-display-token'), config.displayToken)) {
    return error(401, 'Unauthorized');
  }

  const params = new URL(request.url).searchParams;
  const tz = config.timezone;
  const nowMs = parseNowOverride(params.get('now'), tz) ?? Date.now();
  const window = windowFor(nowMs, tz, config.daysAhead);

  let occurrences: Occurrence[] = [];
  if (params.get('demo') === '1') {
    occurrences = expandCalendar(demoCalendar(tz), { timezone: tz, window });
  } else {
    if (!config.calendarUrls.length) {
      console.error('CALENDAR_ICS_URLS is not set');
      return error(500, 'Server is not configured');
    }
    const results = await Promise.allSettled(
      config.calendarUrls.map((url, i) => loadCalendar(url, `calendar ${i + 1}`)),
    );
    let loaded = 0;
    results.forEach((result, i) => {
      if (result.status !== 'fulfilled') return;
      loaded++;
      try {
        occurrences = occurrences.concat(expandCalendar(result.value, { timezone: tz, window }));
      } catch (err) {
        loaded--;
        console.error(`calendar ${i + 1}: could not expand events`, err);
      }
    });
    if (loaded === 0) return error(502, 'Calendar unavailable');
  }

  const body: EventsResponse = {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    timezone: tz,
    events: buildEvents(occurrences, window, tz),
  };
  return Response.json(body, { headers: NO_STORE });
}
