import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Inspirovate Creatives Storyloom',
  description:
    'The Inspirovate Creatives workspace for creating, reviewing, and downloading Instagram stories.',
  icons: { icon: '/brand/inspirovate-logo.jpg', apple: '/brand/inspirovate-logo.jpg' },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
