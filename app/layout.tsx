import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Inspirovate Creatives Storyloom',
  description:
    'The Inspirovate Creatives workspace for creating, reviewing, and downloading Instagram stories.',
  icons: { icon: '/brand/inspirovate-logo.jpg', apple: '/brand/inspirovate-logo.jpg' },
  appleWebApp: { title: 'Storyloom', statusBarStyle: 'default' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
