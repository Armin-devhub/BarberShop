'use client';

import { useState } from 'react';
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
    return <main className="pt-8 text-center text-stone-500">Checking…</main>;
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
    <main className="space-y-8 pt-8">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Welcome</h1>
        <p className="mt-2 text-stone-600">
          Enter your details to join the barbershop queue.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Your name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="given-name"
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base focus:border-stone-900 focus:outline-none"
            placeholder="Ahmad"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-stone-700">Phone number</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base focus:border-stone-900 focus:outline-none"
            placeholder="0123456789"
          />
          <span className="mt-1 block text-xs text-stone-500">
            We send your receipt to this number on WhatsApp.
          </span>
        </label>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          className="w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white hover:bg-stone-800 active:bg-stone-700"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
