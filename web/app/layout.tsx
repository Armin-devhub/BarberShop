import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import FloatingNav from '@/components/FloatingNav';
import BackendGate from '@/components/BackendGate';

const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const serif = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
  style: ['normal', 'italic'],
  display: 'swap'
});

export const metadata: Metadata = {
  title: 'Novyx Barbershop',
  description: 'Walk-in queue for Novyx Barbershop',
  icons: { icon: '/blacklogo.jpeg', apple: '/blacklogo.jpeg' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body className="min-h-screen bg-novyx-bg text-novyx-cream antialiased font-sans">
        <BackendGate>
          <div className="mx-auto max-w-md px-6 pt-6 pb-8">
            {children}
            <FloatingNav />
          </div>
        </BackendGate>
      </body>
    </html>
  );
}
