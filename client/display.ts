// The display page's script. Built by scripts/build-client.mjs into a small
// file that older Safari (iOS 10 and up) can run, and inlined into the page.
// No framework: the page has three regions and changes once a minute.

import type { DisplayConfig } from '../lib/config';
import { buildView, planFullList, type AllDayItem, type CalendarEvent, type EventsResponse, type Row, type View } from '../lib/events';
import { formatTime } from '../lib/format';
import { ICON_SHAPES } from '../lib/icon-shapes';
import { CACHE_NAME, fetchAndSavePage } from '../lib/offline';
import { strings } from '../lib/strings';
import { dateKeyAt, minuteOfDayAt, parseNowOverride } from '../lib/tz';

type Boot = { token: string; config: DisplayConfig; now: string | null; demo: boolean };
type Saved = { savedAt: number; data: EventsResponse };

const FETCH_EVERY_MS = 2 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;
/** Reload once a day at 3:00 AM display time, retrying until 4:00 AM if offline. */
const RELOAD_FROM_MINUTE = 3 * 60;
const RELOAD_UNTIL_MINUTE = 4 * 60;
/** A page loaded less than this long ago never reloads, so 3:00 AM cannot loop. */
const RELOAD_MIN_UPTIME_MS = 60 * 60 * 1000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function div(cls: string, text: string | undefined): string {
  return text ? '<div class="' + cls + '">' + escapeHtml(text) + '</div>' : '';
}

/** An inline SVG for a picture name from lib/event-icons.ts, or '' if none. */
function iconSvg(name: string | undefined, cls: string): string {
  const shape = name ? ICON_SHAPES[name] : undefined;
  if (!shape) return '';
  return (
    '<svg class="' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + shape + '</svg>'
  );
}

function isEventList(value: unknown): value is CalendarEvent[] {
  if (!value || typeof (value as unknown[]).length !== 'number') return false;
  const list = value as CalendarEvent[];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || typeof e.id !== 'string' || typeof e.start !== 'string' || typeof e.end !== 'string') return false;
    if (typeof e.allDay !== 'boolean') return false;
  }
  return true;
}

function clockHtml(v: View): string {
  const period = v.period ? '<span class="period">' + escapeHtml(v.period) + '</span>' : '';
  const clock = '<span class="digits">' + escapeHtml(v.clock) + '</span>';
  return (
    div('weekday', v.weekday) +
    div('part', v.partOfDay) +
    '<div class="time' + (v.periodFirst ? ' period-first' : '') + '">' +
    (v.periodFirst ? period + clock : clock + period) +
    '</div>' +
    div('date', v.date)
  );
}

function cardHtml(v: View): string {
  const c = v.card;
  if (c.state === 'done') {
    return '<div class="card state-done">' + div('title', c.label) + '</div>';
  }
  const icon = iconSvg(c.icon, 'card-icon');
  return (
    '<div class="card state-' + c.state + (icon ? ' has-icon' : '') + '">' +
    icon +
    '<div class="card-body">' +
    div('label', c.label) +
    div('title', c.title) +
    (c.timing
      ? '<div class="timing">' + escapeHtml(c.timing) + (c.detail ? ' <span class="detail">' + escapeHtml(c.detail) + '</span>' : '') + '</div>'
      : '') +
    div('where', c.location) +
    div('note', c.note) +
    div('then', c.then) +
    '</div></div>'
  );
}

/**
 * One list row: time, picture, title, and an optional tag. `whatHtml` is
 * already escaped. Rows without a picture keep an empty picture column so
 * titles line up.
 */
function rowHtml(cls: string, when: string, whatHtml: string, tag?: string, icon?: string): string {
  return (
    '<div class="row' + (cls ? ' ' + cls : '') + '">' +
    '<span class="when">' + escapeHtml(when) + '</span>' +
    '<span class="icon">' + iconSvg(icon, 'row-icon') + '</span>' +
    '<span class="what">' + whatHtml + '</span>' +
    (tag ? '<span class="tag">' + escapeHtml(tag) + '</span>' : '') +
    '</div>'
  );
}

/** The "All day" row: each title with its own picture in front. */
function allDayHtml(cls: string, items: AllDayItem[]): string {
  const what = items.map((i) => iconSvg(i.icon, 'inline-icon') + escapeHtml(i.title)).join(' · ');
  return (
    '<div class="row ' + cls + '">' +
    '<span class="when">' + escapeHtml(strings.allDay) + '</span>' +
    '<span class="what">' + what + '</span>' +
    '</div>'
  );
}

function eventRowHtml(r: Row): string {
  if (r.status === 'past') return rowHtml('past', r.time, escapeHtml(r.title), strings.earlier, r.icon);
  if (r.status === 'now') return rowHtml('now', r.time, escapeHtml(r.title), strings.now, r.icon);
  return rowHtml('', r.time, escapeHtml(r.title), undefined, r.icon);
}

function listHtml(v: View, capacity: number): string {
  const dayRows = v.days.map((d) => (d.allDay.length ? 1 : 0) + d.rows.length);
  const plan = planFullList(v.past.length, v.current.length, v.allDay.length > 0, dayRows, capacity);
  const today = plan.today;
  let html = '';
  if (v.allDay.length) html += allDayHtml('allday', v.allDay);
  if (today.earlierLine) html += rowHtml('summary', '', escapeHtml(strings.earlierCount(today.hiddenPast)));
  for (let i = today.hiddenPast; i < v.past.length; i++) html += eventRowHtml(v.past[i]);
  for (let i = 0; i < today.shownCurrent; i++) html += eventRowHtml(v.current[i]);
  if (today.moreLater > 0) html += rowHtml('more', '', escapeHtml(strings.moreLater(today.moreLater)));

  // Coming days: a heading per day, then its events in a quieter style.
  for (let p = 0; p < plan.days.length; p++) {
    const dp = plan.days[p];
    const day = v.days[dp.index];
    html +=
      '<div class="row dayhead"><span class="what">' + escapeHtml(day.label) + '</span>' +
      '<span class="day-date">' + escapeHtml(day.date) + '</span></div>';
    const rows: string[] = [];
    if (day.allDay.length) rows.push(allDayHtml('ahead allday', day.allDay));
    for (let i = 0; i < day.rows.length; i++) {
      const r = day.rows[i];
      rows.push(rowHtml('ahead', r.time, escapeHtml(r.title), undefined, r.icon));
    }
    for (let i = 0; i < dp.shown; i++) html += rows[i];
    if (dp.more > 0) {
      html += rowHtml('more ahead', '', escapeHtml(dp.shown > 0 ? strings.moreOnDay(dp.more) : strings.eventCount(dp.more)));
    }
  }
  return html;
}

/**
 * Installs the service worker that lets the page start with no internet (see
 * lib/offline.ts). Optional: Safari before iOS 11.3 has no service workers,
 * and browsers only allow them on https or localhost. The page works the same
 * without one.
 */
function registerServiceWorker(): void {
  try {
    const sw = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (!sw || !window.caches) return;
    // Loaded without the worker (first visit, or a reload that skipped it):
    // the worker did not see this load, so save the page here.
    const unsaved = !sw.controller;
    sw.register('/sw.js', { scope: '/d/' })
      .then(function () {
        if (!unsaved) return;
        return fetchAndSavePage(window.location.href, {
          fetch: function (input) {
            return fetch(input);
          },
          openCache: function () {
            return window.caches.open(CACHE_NAME);
          },
          setTimeout: function (fn, ms) {
            return window.setTimeout(fn, ms);
          },
        });
      })
      .catch(function () {
        // Without the worker the page still works while it stays open.
      });
  } catch (e) {
    // See above.
  }
}

function start(): void {
  const bootEl = document.getElementById('boot');
  const boot: Boot = JSON.parse((bootEl && bootEl.textContent) || '{}');
  const config = boot.config;
  const tz = config.timezone;
  const root = document.documentElement;
  const clockEl = document.getElementById('clock') as HTMLElement;
  const cardEl = document.getElementById('card') as HTMLElement;
  const listEl = document.getElementById('list') as HTMLElement;
  const staleEl = document.getElementById('stale') as HTMLElement;

  const loadedAt = Date.now();
  const override = parseNowOverride(boot.now, tz);
  const now = (): number => (override === null ? Date.now() : override + (Date.now() - loadedAt));
  const storageKey = 'today-display:v1:' + (boot.demo ? 'demo' : 'live') + (override === null ? '' : ':debug');

  let events: CalendarEvent[] = [];
  let hasData = false;
  let lastSuccess = 0;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as Saved;
      if (saved && saved.data && isEventList(saved.data.events) && typeof saved.savedAt === 'number') {
        events = saved.data.events;
        lastSuccess = saved.savedAt;
        hasData = true;
      }
    }
  } catch (e) {
    // Storage can be missing or full; the page works without it.
  }

  const rendered: { [id: string]: string } = {};
  function setHtml(el: HTMLElement, html: string): boolean {
    if (rendered[el.id] === html) return false;
    rendered[el.id] = html;
    el.innerHTML = html;
    return true;
  }

  let cardKey = '';
  let listKey = '';
  let fadeTimer = 0;

  function renderCard(v: View): void {
    const html = hasData ? cardHtml(v) : '';
    const key = v.card.state + '|' + (v.card.title || '');
    if (cardKey && key !== cardKey && html !== rendered[cardEl.id]) {
      // A different event or state: fade out, swap, fade in.
      cardKey = key;
      cardEl.style.opacity = '0';
      clearTimeout(fadeTimer);
      fadeTimer = window.setTimeout(function () {
        setHtml(cardEl, html);
        listKey = '';
        renderList(v);
        cardEl.style.opacity = '1';
      }, 300);
      return;
    }
    cardKey = key;
    setHtml(cardEl, html);
  }

  function fits(): boolean {
    return listEl.scrollHeight <= listEl.clientHeight + 1;
  }

  function renderList(v: View): void {
    if (!hasData) {
      setHtml(listEl, '');
      return;
    }
    const key = JSON.stringify([v.allDay, v.past, v.current, v.days]) + '|' + listEl.clientHeight + '|' + listEl.clientWidth;
    if (key === listKey) return;
    listKey = key;
    // Try everything first. If it does not fit, work out how many rows do.
    setHtml(listEl, listHtml(v, 1000));
    if (fits()) return;
    // Start from the shortest row (day headings are taller), then shrink
    // until it fits.
    let rowHeight = 0;
    const children = listEl.children;
    for (let i = 0; i < children.length; i++) {
      const h = (children[i] as HTMLElement).offsetHeight;
      if (h > 0 && (rowHeight === 0 || h < rowHeight)) rowHeight = h;
    }
    let capacity = Math.max(1, Math.floor(listEl.clientHeight / Math.max(1, rowHeight)));
    for (let i = 0; i < 30; i++) {
      setHtml(listEl, listHtml(v, capacity));
      if (fits() || capacity <= 1) break;
      capacity--;
    }
  }

  function renderStale(): void {
    let text = '';
    if (hasData && Date.now() - lastSuccess > STALE_AFTER_MS) {
      text = strings.lastUpdated(formatTime(lastSuccess, tz, config.locale));
    }
    setHtml(staleEl, text ? escapeHtml(text) : '');
  }

  function render(): void {
    let v: View;
    try {
      v = buildView(events, now(), config);
    } catch (e) {
      // Bad data must never stop the clock.
      v = buildView([], now(), config);
    }
    root.className = 'theme-' + config.theme + (v.night ? ' night' : '');
    setHtml(clockEl, clockHtml(v));
    renderCard(v);
    renderList(v);
    renderStale();
  }

  let fetching = false;
  function fetchEvents(): void {
    if (fetching) return;
    fetching = true;
    const query: string[] = [];
    if (boot.demo) query.push('demo=1');
    if (override !== null) query.push('now=' + encodeURIComponent(new Date(now()).toISOString()));
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '/api/events' + (query.length ? '?' + query.join('&') : ''), true);
    xhr.setRequestHeader('x-display-token', boot.token);
    xhr.timeout = FETCH_TIMEOUT_MS;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      fetching = false;
      if (xhr.status !== 200) return;
      let data: EventsResponse;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        return;
      }
      if (!data || !isEventList(data.events)) return;
      events = data.events;
      hasData = true;
      lastSuccess = Date.now();
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ savedAt: lastSuccess, data: data } as Saved));
      } catch (e) {
        // See above.
      }
      render();
    };
    xhr.send();
  }

  let reloading = false;
  function maybeReload(t: number): void {
    if (reloading || Date.now() - loadedAt < RELOAD_MIN_UPTIME_MS) return;
    const minute = minuteOfDayAt(t, tz);
    if (minute < RELOAD_FROM_MINUTE || minute >= RELOAD_UNTIL_MINUTE) return;
    // Only reload when the server answers. Without the service worker,
    // reloading while offline would replace the page with the browser's
    // error screen. (The worker does not answer this HEAD request.)
    reloading = true;
    const xhr = new XMLHttpRequest();
    xhr.open('HEAD', window.location.href, true);
    xhr.timeout = FETCH_TIMEOUT_MS;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4) return;
      if (xhr.status === 200) window.location.reload();
      else reloading = false;
    };
    xhr.send();
  }

  let lastMinute = -1;
  let lastDay = '';
  function tick(): void {
    const t = now();
    const minute = Math.floor(t / 60000);
    if (minute === lastMinute) return;
    lastMinute = minute;
    const day = dateKeyAt(t, tz);
    if (lastDay && day !== lastDay) fetchEvents();
    lastDay = day;
    render();
    maybeReload(t);
  }

  window.addEventListener('resize', function () {
    listKey = '';
    render();
  });

  tick();
  fetchEvents();
  window.setInterval(tick, 1000);
  window.setInterval(fetchEvents, FETCH_EVERY_MS);
  registerServiceWorker();
}

start();
