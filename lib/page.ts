// Builds the display page's HTML. The page is plain HTML with an inlined
// stylesheet and script, without React, so it stays small for the Pi Zero
// and runs on older iPad Safari (see README, "Why the display page is not React").

import type { DisplayConfig } from './config';
import { DISPLAY_CSS, DISPLAY_JS } from './generated/display-assets';
import { palettes, paletteCss } from './theme';

export type PageOptions = {
  token: string;
  config: DisplayConfig;
  /** The raw `?now=` value, read by the script. */
  now: string | null;
  demo: boolean;
};

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function renderDisplayPage(o: PageOptions): string {
  const theme = o.config.theme;
  const lang = o.config.locale.split('-')[0];
  const boot = { token: o.token, config: o.config, now: o.now, demo: o.demo };
  return `<!doctype html>
<html lang="${escapeAttr(lang)}" class="theme-${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Today">
<meta name="theme-color" content="${palettes[theme].bg}">
<title>Today</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-icon">
<link rel="icon" href="/icon" type="image/png">
<style>${paletteCss()}${DISPLAY_CSS}</style>
</head>
<body>
<div id="app"><section id="clock" class="clock"></section><section class="main"><div id="card" class="card-wrap"></div><div id="list" class="list"></div></section><div id="stale" class="stale"></div></div>
<script id="boot" type="application/json">${scriptJson(boot)}</script>
<script>${DISPLAY_JS}</script>
</body>
</html>
`;
}
