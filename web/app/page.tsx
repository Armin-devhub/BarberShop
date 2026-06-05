'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { saveCustomer } from '@/lib/customer';
import { useActiveEntryRedirect } from '@/lib/active-entry';
import { normalizeMyPhone } from '@shared/types';

export default function LandingPage() {
  const router = useRouter();
  const { checking } = useActiveEntryRedirect();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  if (checking) {
    return <main className="pt-8 text-center text-novyx-muted">Checking…</main>;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();
    if (!trimmedName || !trimmedPhone) {
      setError('Both name and phone are required.');
      return;
    }
    const digits = trimmedPhone.replace(/\D/g, '');
    if (digits.length < 9) {
      setError('Please enter a valid phone number.');
      return;
    }
    saveCustomer({ name: trimmedName, phone: normalizeMyPhone(trimmedPhone) });
    router.push('/barbers');
  }

  return (
    <main className="space-y-6 pt-4">
      {/* Step indicator */}
      <div className="flex gap-1.5">
        <span className="h-0.5 w-6 rounded-full bg-novyx-gold" />
        <span className="h-0.5 w-6 rounded-full bg-novyx-border" />
        <span className="h-0.5 w-6 rounded-full bg-novyx-border" />
      </div>

      <header className="space-y-2">
        <Image
          src="/blacklogo.jpeg"
          alt="Novyx"
          width={48}
          height={48}
          className="rounded-full object-cover"
          priority
        />
        <p className="text-[10px] font-semibold tracking-[0.2em] text-novyx-gold">— NOVYX —</p>
        <h1 className="font-serif text-4xl italic text-novyx-cream">Welcome</h1>
        <p className="text-sm italic text-novyx-muted">Tell us who you are to join the queue.</p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold tracking-[0.15em] text-novyx-gold">YOUR NAME</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
            className="block w-full rounded-sm border border-novyx-border bg-novyx-surface px-3.5 py-3 text-base text-novyx-cream placeholder:text-novyx-subtle focus:border-novyx-gold focus:outline-none"
            placeholder="Daniel Tan"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-[10px] font-bold tracking-[0.15em] text-novyx-gold">WHATSAPP PHONE</span>
          <div className="flex items-stretch rounded-sm border border-novyx-border bg-novyx-surface focus-within:border-novyx-gold">
            <span className="flex items-center px-3.5 text-base font-semibold text-novyx-gold">+60</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              autoComplete="tel"
              inputMode="numeric"
              className="block w-full bg-transparent py-3 pr-3.5 text-base text-novyx-cream placeholder:text-novyx-subtle focus:outline-none"
              placeholder="12 345 6789"
            />
          </div>
          <span className="block text-[11px] italic text-novyx-subtle">We text your receipt here.</span>
        </label>

        {error && (
          <p className="rounded-sm border border-novyx-danger/40 bg-novyx-danger/10 px-3 py-2 text-sm text-novyx-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="block w-full rounded-sm bg-novyx-gold px-4 py-3.5 text-xs font-bold tracking-[0.2em] text-novyx-bg hover:bg-novyx-goldHi"
        >
          CONTINUE
        </button>
      </form>
    </main>
  );
}
