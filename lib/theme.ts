// Display colours. tests/contrast.test.ts checks every text colour against
// its background: at least 7:1 for main text, 4.5:1 for dimmed past events.

export type Palette = {
  bg: string;
  /** Main text: day, time, titles. */
  text: string;
  /** Secondary text: part of day, date, list times, location. */
  muted: string;
  /** Past events and the staleness line. */
  dim: string;
  /** Hairlines between list rows. Not text. */
  line: string;
  /** Border of the "Coming up" card. Not text. */
  lineStrong: string;
  /** Background of each coming day's heading. Text and muted text sit on it. */
  band: string;
  /** Border of the "Soon" card. Not text. */
  accent: string;
  /** The "Soon" label. */
  accentText: string;
  /** The "Now" card and the "Now" tag in the list. */
  nowBg: string;
  nowText: string;
  nowMuted: string;
};

export const palettes: { [name: string]: Palette } = {
  dark: {
    bg: '#0a0a0a',
    text: '#f3f0e8',
    muted: '#cfcabf',
    dim: '#8c877d',
    line: '#2e2c28',
    lineStrong: '#77726a',
    band: '#26241f',
    accent: '#f5c451',
    accentText: '#f5c451',
    nowBg: '#f5c451',
    nowText: '#141008',
    nowMuted: '#3a2e10',
  },
  // Night: the same layout with everything dimmed.
  darkNight: {
    bg: '#000000',
    text: '#bdb8ae',
    muted: '#a39e94',
    dim: '#7a766d',
    line: '#1c1b19',
    lineStrong: '#4f4c46',
    band: '#121110',
    accent: '#b8924a',
    accentText: '#bf9a52',
    nowBg: '#b8924a',
    nowText: '#000000',
    nowMuted: '#000000',
  },
  light: {
    bg: '#f4f1ea',
    text: '#15130f',
    muted: '#3b3832',
    dim: '#69645b',
    line: '#d9d4c9',
    lineStrong: '#8f897d',
    band: '#e2ddd2',
    accent: '#c9962c',
    accentText: '#5c3d00',
    nowBg: '#f5c451',
    nowText: '#15130f',
    nowMuted: '#3a2e10',
  },
  lightNight: {
    bg: '#a8a399',
    text: '#000000',
    muted: '#1a1814',
    dim: '#2e2b26',
    line: '#938e85',
    lineStrong: '#5c5850',
    band: '#bdb8ad',
    accent: '#6b4a10',
    accentText: '#1a1100',
    nowBg: '#c9a043',
    nowText: '#000000',
    nowMuted: '#1a1408',
  },
};

function vars(p: Palette): string {
  return (
    `--bg:${p.bg};--text:${p.text};--muted:${p.muted};--dim:${p.dim};--line:${p.line};` +
    `--line-strong:${p.lineStrong};--band:${p.band};--accent:${p.accent};--accent-text:${p.accentText};` +
    `--now-bg:${p.nowBg};--now-text:${p.nowText};--now-muted:${p.nowMuted};`
  );
}

/** CSS custom properties for both themes, by day and by night. */
export function paletteCss(): string {
  return (
    `.theme-dark{${vars(palettes.dark)}}` +
    `.theme-dark.night{${vars(palettes.darkNight)}}` +
    `.theme-light{${vars(palettes.light)}}` +
    `.theme-light.night{${vars(palettes.lightNight)}}`
  );
}
