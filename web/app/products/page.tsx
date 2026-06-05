'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatRM } from '@shared/types';

interface Product {
  id: string;
  name: string;
  price_sen: number;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // RLS already limits anon reads to active products.
      const { data, error } = await supabase
        .from('products')
        .select('id, name, price_sen')
        .order('price_sen', { ascending: true });
      if (cancelled) return;
      if (error) setError(error.message);
      else setProducts((data as Product[] | null) ?? []);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="space-y-5 pt-4">
      <header className="space-y-1">
        <p className="text-[10px] font-semibold tracking-[0.2em] text-novyx-gold">— NOVYX —</p>
        <h1 className="font-serif text-3xl italic leading-tight text-novyx-cream">Our Products</h1>
        <p className="text-sm italic text-novyx-muted">Take the shop home with you.</p>
      </header>

      {error && (
        <p className="rounded-sm border border-novyx-danger/40 bg-novyx-danger/10 px-3 py-2 text-sm text-novyx-danger">
          {error}
        </p>
      )}

      {products === null && !error && <p className="text-novyx-muted">Loading…</p>}

      {products && products.length === 0 && (
        <div className="rounded-sm border border-novyx-border bg-novyx-surface p-6 text-center">
          <p className="font-medium text-novyx-cream">No products listed yet.</p>
          <p className="mt-1 text-sm italic text-novyx-muted">Ask your barber what's in stock.</p>
        </div>
      )}

      {products && products.length > 0 && (
        <ul className="space-y-2.5">
          {products.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-sm border border-novyx-border bg-novyx-surface px-4 py-3.5"
            >
              <span className="font-serif text-xl italic text-novyx-cream">{p.name}</span>
              <span className="font-semibold text-novyx-gold">{formatRM(p.price_sen)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
