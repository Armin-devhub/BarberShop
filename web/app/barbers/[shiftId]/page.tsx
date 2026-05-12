'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getCustomer } from '@/lib/customer';
import { setActiveEntryId, useActiveEntryRedirect } from '@/lib/active-entry';
import {
  formatRM,
  type BarberShiftService,
  type DiscountPreview,
  type QueueEntry
} from '@shared/types';

export default function BarberServicesPage() {
  const router = useRouter();
  const { shiftId } = useParams<{ shiftId: string }>();
  const { checking } = useActiveEntryRedirect();

  const [services, setServices] = useState<BarberShiftService[] | null>(null);
  const [error, setError] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [discountInput, setDiscountInput] = useState('');
  const [discountPreview, setDiscountPreview] = useState<DiscountPreview | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const customer = useMemo(() => (typeof window !== 'undefined' ? getCustomer() : null), []);
  const staffName = services?.[0]?.staff_name ?? '';
  const staffId = services?.[0]?.staff_id ?? '';
  const selectedService = services?.find((s) => s.service_id === selectedServiceId) ?? null;

  useEffect(() => {
    if (typeof window !== 'undefined' && !getCustomer()) {
      router.replace('/');
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data, error } = await supabase
        .from('barber_shift_services')
        .select('*')
        .eq('shift_id', shiftId)
        .order('price_sen');
      if (cancelled) return;
      if (error) setError(error.message);
      else setServices(data ?? []);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  // Re-preview the discount when service or code changes.
  useEffect(() => {
    if (!selectedServiceId || !discountInput.trim()) {
      setDiscountPreview(null);
      return;
    }
    let cancelled = false;
    setValidating(true);
    supabase
      .rpc('preview_discount', {
        p_code: discountInput.trim(),
        p_service_id: selectedServiceId
      })
      .single<DiscountPreview>()
      .then(({ data, error }) => {
        if (cancelled) return;
        setValidating(false);
        if (error) {
          setDiscountPreview({
            valid: false,
            percent: null,
            base_price_sen: null,
            final_price_sen: null,
            message: error.message
          });
        } else {
          setDiscountPreview(data);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [discountInput, selectedServiceId]);

  async function handleJoinQueue() {
    if (!customer || !selectedService || !staffId) return;
    setSubmitting(true);
    setError('');
    const { data, error } = await supabase
      .rpc('create_queue_entry', {
        p_staff_id: staffId,
        p_customer_name: customer.name,
        p_customer_phone: customer.phone,
        p_service_id: selectedService.service_id,
        p_discount_code: discountInput.trim() || null
      })
      .single<QueueEntry>();

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data) {
      setActiveEntryId(data.id);
      router.push(`/queue/${data.id}`);
    }
  }

  const finalPrice = (() => {
    if (!selectedService) return null;
    if (discountPreview?.valid && discountPreview.final_price_sen != null) {
      return discountPreview.final_price_sen;
    }
    return selectedService.price_sen;
  })();

  if (checking) {
    return <main className="pt-8 text-center text-stone-500">Checking…</main>;
  }

  return (
    <main className="space-y-6">
      <Link href="/barbers" className="text-sm text-stone-600 hover:text-stone-900">
        ← Back to barbers
      </Link>

      <header>
        <h1 className="text-2xl font-bold">{staffName || 'Loading…'}</h1>
        <p className="mt-1 text-sm text-stone-600">Pick a service to join the queue.</p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {services === null && !error && <p className="text-stone-500">Loading services…</p>}

      {services && services.length === 0 && !error && (
        <p className="rounded-lg bg-stone-100 p-4 text-stone-600">
          This barber hasn't picked any services for today.
        </p>
      )}

      {services && services.length > 0 && (
        <ul className="space-y-2">
          {services.map((s) => {
            const isSelected = s.service_id === selectedServiceId;
            return (
              <li key={s.service_id}>
                <button
                  type="button"
                  onClick={() => setSelectedServiceId(s.service_id)}
                  className={`flex w-full items-center justify-between rounded-lg border p-4 text-left ${
                    isSelected
                      ? 'border-stone-900 bg-stone-900 text-white'
                      : 'border-stone-200 bg-white hover:border-stone-400'
                  }`}
                >
                  <div>
                    <div className="font-medium">{s.service_name}</div>
                    <div className={`text-xs ${isSelected ? 'text-stone-300' : 'text-stone-500'}`}>
                      ~{s.duration_minutes} min
                    </div>
                  </div>
                  <div className="font-semibold">{formatRM(s.price_sen)}</div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selectedService && (
        <section className="space-y-3 border-t border-stone-200 pt-4">
          <label className="block">
            <span className="text-sm font-medium text-stone-700">Discount code (optional)</span>
            <input
              type="text"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 uppercase tracking-wider focus:border-stone-900 focus:outline-none"
              placeholder="WELCOME10"
            />
            {validating && (
              <span className="mt-1 block text-xs text-stone-500">Checking…</span>
            )}
            {!validating && discountPreview && discountInput.trim() && (
              <span
                className={`mt-1 block text-xs ${
                  discountPreview.valid ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {discountPreview.valid && discountPreview.percent != null
                  ? `${discountPreview.percent}% off applied`
                  : discountPreview.message}
              </span>
            )}
          </label>

          <div className="flex items-baseline justify-between rounded-lg bg-stone-100 p-4">
            <span className="text-sm text-stone-600">Total</span>
            <span className="text-2xl font-bold">
              {finalPrice != null ? formatRM(finalPrice) : '—'}
            </span>
          </div>

          <button
            type="button"
            disabled={submitting || !selectedService || validating}
            onClick={handleJoinQueue}
            className="w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {submitting ? 'Joining…' : 'Join queue'}
          </button>
        </section>
      )}
    </main>
  );
}
