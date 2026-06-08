'use client';

// Bottom-of-page navigation for the customer flow.
//   • On the product catalog: a primary, sticky onward CTA (book a barber, or
//     back to the live queue if already booked).
//   • On every other page (queue, barber list/detail): a quiet, NON-sticky
//     "See our products" text link at the end of the page content.
//   • Nothing on the landing (name/phone) form.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getActiveEntryId } from '@/lib/active-entry';

export default function FloatingNav() {
  const pathname = usePathname();
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

  // Re-read the stored entry on every navigation so the CTA stays in sync after
  // a customer books (or after their entry is cleared).
  useEffect(() => {
    setActiveEntryId(getActiveEntryId());
  }, [pathname]);

  // No CTA on the landing (name/phone) form.
  if (pathname === '/') return null;

  // On the catalog: keep the prominent, sticky onward action.
  if (pathname === '/products') {
    const href = activeEntryId ? `/queue/${activeEntryId}` : '/barbers';
    const label = activeEntryId ? 'See Your Queue' : 'Book A Barber';
    return (
      <>
        {/* Spacer so the fixed bar never covers the last bit of content. */}
        <div aria-hidden className="h-28" />
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
          <div className="mx-auto max-w-md bg-gradient-to-t from-novyx-bg via-novyx-bg/95 to-transparent px-6 pb-6 pt-10">
            <Link
              href={href}
              className="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-sm bg-novyx-gold px-4 py-3.5 text-xs font-bold tracking-[0.2em] text-novyx-bg shadow-lg shadow-black/40 hover:bg-novyx-goldHi"
            >
              {label.toUpperCase()}
              <span aria-hidden className="text-base leading-none">→</span>
            </Link>
          </div>
        </div>
      </>
    );
  }

  // Everywhere else: a quiet text link at the end of the page (not sticky).
  return (
    <div className="mt-12 border-t border-novyx-border/60 pt-6 text-center">
      <Link
        href="/products"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-novyx-gold hover:text-novyx-goldHi"
      >
        See our products
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
