import { describe, expect, it } from 'vitest';
import { palettes } from '@/lib/theme';

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(Object.keys(palettes))('%s palette', (name) => {
  const p = palettes[name];
  it.each([
    ['text', 7, p.text, p.bg],
    ['muted', 7, p.muted, p.bg],
    ['accentText', 7, p.accentText, p.bg],
    ['nowText', 7, p.nowText, p.nowBg],
    ['nowMuted', 7, p.nowMuted, p.nowBg],
    ['dim', 4.5, p.dim, p.bg],
  ] as [string, number, string, string][])('%s is at least %d:1', (_label, min, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});
