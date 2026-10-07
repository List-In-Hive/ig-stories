import type { MetadataRoute } from 'next';
// Lets the app be added to an iPhone home screen and open full screen like a native app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Inspirovate Creatives Storyloom',
    short_name: 'Storyloom',
    description: 'Daily Instagram story drafts, reviewed and ready to post.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f7f7',
    theme_color: '#ffffff',
    icons: [{ src: '/brand/inspirovate-logo.jpg', sizes: 'any', type: 'image/jpeg' }],
  };
}
