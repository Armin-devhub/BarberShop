'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getCustomer } from '@/lib/customer';
import { setActiveEntry, useActiveEntryRedirect } from '@/lib/active-entry';
import {
  formatRM,
  type BarberShiftService,
  type DiscountPreview,
  type QueueEntry
} from '@shared/types';

// Sentinel for the "Custom Service" choice (no catalog service / price).
const CUSTOM_SERVICE = '__custom__';

export default function BarberServicesPage() {
  const router = useRouter();
  const { shiftId } = useParams<{ shiftId: string }>();
  const { checking } = useActiveEntryRedirect();

  const [services, setServices] = useState<BarberShiftService[] | null>(null);
  const [barber, setBarber] = useState<{ staff_id: string; staff_name: string } | null>(null);
  const [error, setError] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [discountInput, setDiscountInput] = useState('');
  const [discountPreview, setDiscountPreview] = useState<DiscountPreview | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const customer = useMemo(() => (typeof window !== 'undefined' ? getCustomer() : null), []);
  const isCustom = selectedServiceId === CUSTOM_SERVICE;
  const selectedService = isCustom
    ? null
    : (services?.find((s) => s.service_id === selectedServiceId) ?? null);
  const hasSelection = isCustom || !!selectedService;
  // Prefer the on-shift barber record so Custom Service works even if the barber
  // picked no catalog services today.
  const staffName = barber?.staff_name ?? services?.[0]?.staff_name ?? '';
  const staffId = barber?.staff_id ?? services?.[0]?.staff_id ?? '';

  useEffect(() => {
    if (typeof window !== 'undefined' && !getCustomer()) {
      router.replace('/');
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('barbers_on_shift')
      .select('staff_id, staff_name')
      .eq('shift_id', shiftId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data) setBarber(data as { staff_id: string; staff_name: string });
      });
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

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
        p_service_id: isCustom ? null : selectedServiceId
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
    if (!customer || !hasSelection || !staffId) return;
    setSubmitting(true);
    setError('');
    const { data, error } = await supabase
      .rpc('create_queue_entry', {
        p_staff_id: staffId,
        p_customer_name: customer.name,
        p_customer_phone: customer.phone,
        p_service_id: isCustom ? null : selectedService!.service_id,
        p_discount_code: discountInput.trim() || null
      })
      .single<QueueEntry>();

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (data) {
      setActiveEntry(data.id, data.cancel_token);
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
    return <main className="pt-8 text-center text-novyx-muted">Checking…</main>;
  }

  return (
    <main className="space-y-5 pt-4">
      <div className="flex gap-1.5">
        <span className="h-0.5 w-6 rounded-full bg-novyx-gold" />
        <span className="h-0.5 w-6 rounded-full bg-novyx-gold" />
        <span className="h-0.5 w-6 rounded-full bg-novyx-gold" />
      </div>

      <Link
        href="/barbers"
        className="block text-[10px] font-semibold tracking-[0.2em] text-novyx-gold hover:text-novyx-goldHi"
      >
        ← BACK TO BARBERS
      </Link>

      <header className="space-y-1">
        <h1 className="font-serif text-3xl italic text-novyx-cream">{staffName || 'Loading…'}</h1>
        <p className="text-sm italic text-novyx-muted">Pick a service.</p>
      </header>

      {error && (
        <p className="rounded-sm border border-novyx-danger/40 bg-novyx-danger/10 px-3 py-2 text-sm text-novyx-danger">
          {error}
        </p>
      )}

      {services === null && !error && <p className="text-novyx-muted">Loading services…</p>}

      {services && !error && (
        <ul className="space-y-2.5">
          {/* Custom Service — always available, no preset price. */}
          <li>
            <button
              type="button"
              onClick={() => setSelectedServiceId(CUSTOM_SERVICE)}
              className={`flex w-full items-center rounded-sm border px-4 py-3.5 text-left bg-novyx-surface ${
                isCustom ? 'border-novyx-gold border-2' : 'border-novyx-border hover:border-novyx-muted'
              }`}
            >
              <span
                className={`mr-3 flex h-5 w-5 items-center justify-center rounded-full border ${
                  isCustom ? 'border-novyx-gold bg-novyx-gold text-novyx-bg' : 'border-novyx-border'
                }`}
              >
                {isCustom && <span className="text-[10px] font-bold">✓</span>}
              </span>
              <span className="flex-1 space-y-0.5">
                <span className="block font-serif text-lg italic text-novyx-cream">
                  Custom Service
                </span>
                <span className="block text-[10px] font-bold tracking-[0.15em] text-novyx-gold">
                  NOT SURE YET? YOUR BARBER DECIDES{isCustom ? ' · SELECTED' : ''}
                </span>
              </span>
              <span
                className={`text-[10px] font-bold tracking-[0.15em] ${
                  isCustom ? 'text-novyx-gold' : 'text-novyx-muted'
                }`}
              >
                BARBER SETS
              </span>
            </button>
          </li>

          {services.map((s) => {
            const isSelected = s.service_id === selectedServiceId;
            return (
              <li key={s.service_id}>
                <button
                  type="button"
                  onClick={() => setSelectedServiceId(s.service_id)}
                  className={`flex w-full items-center rounded-sm border px-4 py-3.5 text-left bg-novyx-surface ${
                    isSelected ? 'border-novyx-gold border-2' : 'border-novyx-border hover:border-novyx-muted'
                  }`}
                >
                  {/* Radio indicator */}
                  <span
                    className={`mr-3 flex h-5 w-5 items-center justify-center rounded-full border ${
                      isSelected
                        ? 'border-novyx-gold bg-novyx-gold text-novyx-bg'
                        : 'border-novyx-border'
                    }`}
                  >
                    {isSelected && <span className="text-[10px] font-bold">✓</span>}
                  </span>
                  <span className="flex-1 space-y-0.5">
                    <span className="block font-serif text-lg italic text-novyx-cream">
                      {s.service_name}
                    </span>
                    <span className="block text-[10px] font-bold tracking-[0.15em] text-novyx-gold">
                      ~{s.duration_minutes} MIN
                      {isSelected ? ' · SELECTED' : ''}
                    </span>
                  </span>
                  <span
                    className={`text-base font-bold ${
                      isSelected ? 'text-novyx-gold' : 'text-novyx-muted'
                    }`}
                  >
                    {formatRM(s.price_sen)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hasSelection && (
        <section className="space-y-4 pt-2">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-bold tracking-[0.15em] text-novyx-gold">
              DISCOUNT CODE (OPTIONAL)
            </span>
            <input
              type="text"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={`block w-full rounded-sm border bg-novyx-surface px-3.5 py-3 uppercase tracking-[0.15em] text-novyx-cream focus:outline-none ${
                discountPreview?.valid
                  ? 'border-novyx-ok'
                  : discountPreview && !discountPreview.valid
                    ? 'border-novyx-danger'
                    : 'border-novyx-border focus:border-novyx-gold'
              }`}
              placeholder="WALK10"
            />
            {validating && (
              <span className="block text-[11px] italic text-novyx-muted">Checking…</span>
            )}
            {!validating && discountPreview && discountInput.trim() && (
              <span
                className={`block text-[10px] font-bold tracking-[0.15em] ${
                  discountPreview.valid ? 'text-novyx-ok' : 'text-novyx-danger'
                }`}
              >
                {discountPreview.valid && discountPreview.percent != null
                  ? `${discountPreview.percent}% OFF APPLIED`
                  : discountPreview.message}
              </span>
            )}
          </label>

          <div className="flex items-baseline justify-between border-y border-novyx-border py-3">
            <span className="text-[10px] font-bold tracking-[0.2em] text-novyx-gold">TOTAL</span>
            {isCustom ? (
              <span className="text-sm italic text-novyx-muted">Set by your barber</span>
            ) : (
              <span className="font-serif text-3xl italic text-novyx-cream">
                {finalPrice != null ? formatRM(finalPrice) : '—'}
              </span>
            )}
          </div>

          {isCustom && (
            <p className="-mt-2 text-[11px] italic text-novyx-muted">
              {discountPreview?.valid
                ? 'Your discount will apply to the price your barber sets.'
                : 'Your barber will set the price when finishing your service.'}
            </p>
          )}

          <button
            type="button"
            disabled={submitting || !hasSelection || validating}
            onClick={handleJoinQueue}
            className="block w-full rounded-sm bg-novyx-gold px-4 py-3.5 text-xs font-bold tracking-[0.2em] text-novyx-bg hover:bg-novyx-goldHi disabled:opacity-50"
          >
            {submitting ? 'JOINING…' : 'JOIN QUEUE  →'}
          </button>
        </section>
      )}
    </main>
  );
}
