import type { MetadataRoute } from 'next';
import { palettes } from '@/lib/theme';

// No start_url on purpose: browsers then use the address of the page that
// linked the manifest, which is the display page with its token.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Today',
    short_name: 'Today',
    display: 'standalone',
    orientation: 'any',
    background_color: palettes.dark.bg,
    theme_color: palettes.dark.bg,
    icons: [{ src: '/icon', sizes: '512x512', type: 'image/png', purpose: 'any' }],
  };
}
