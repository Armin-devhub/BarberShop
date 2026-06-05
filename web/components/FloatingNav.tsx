'use client';

// Floating call-to-action pinned to the bottom of every customer page after
// the name/phone landing form. On most pages it points to the product
// catalog; on the catalog itself it points onward to booking — or back to the
// customer's live queue if they've already booked.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getActiveEntryId } from '@/lib/active-entry';

export default function FloatingNav() {
  const pathname = usePathname();
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);

  // Re-read the stored entry on every navigation so the catalog button stays
  // in sync after a customer books (or after their entry is cleared).
  useEffect(() => {
    setActiveEntryId(getActiveEntryId());
  }, [pathname]);

  // No CTA on the landing (name/phone) form.
  if (pathname === '/') return null;

  const onProducts = pathname === '/products';

  let href: string;
  let label: string;
  if (onProducts) {
    if (activeEntryId) {
      href = `/queue/${activeEntryId}`;
      label = 'See Your Queue';
    } else {
      href = '/barbers';
      label = 'Book A Barber';
    }
  } else {
    href = '/products';
    label = 'See Our Products';
  }

  return (
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
  );
}
