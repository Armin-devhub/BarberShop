import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'Book Your Cut',
  description: 'Walk-in queue for the barbershop'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased font-sans">
        <div className="mx-auto max-w-md px-4 py-6">{children}</div>
      </body>
    </html>
  );
}
