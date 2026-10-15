// The Home Screen icon: a page from a wall calendar. Drawn with boxes only,
// so it needs no font.

import { ImageResponse } from 'next/og';

export function calendarIcon(size: number): ImageResponse {
  const u = size / 100;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 70 * u, height: 66 * u, borderRadius: 9 * u, background: '#f3f0e8', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ height: 18 * u, background: '#f5c451', display: 'flex' }} />
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 26 * u, height: 26 * u, borderRadius: 13 * u, border: `${5 * u}px solid #141008`, display: 'flex' }} />
          </div>
        </div>
      </div>
    ),
    { width: size, height: size },
  );
}
