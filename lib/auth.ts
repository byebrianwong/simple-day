// Token comparison that takes the same time whether or not the first
// characters match, so the token cannot be guessed one character at a time.

import { createHash, timingSafeEqual } from 'node:crypto';

export function tokenMatches(given: string | null | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
