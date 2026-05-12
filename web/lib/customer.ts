// Lightweight per-browser customer profile, kept in localStorage so a page
// refresh doesn't kick the user back to the landing form.

const KEY = 'barbershop.customer';

export interface CustomerProfile {
  name: string;
  phone: string;
}

export function saveCustomer(profile: CustomerProfile): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, JSON.stringify(profile));
}

export function getCustomer(): CustomerProfile | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CustomerProfile;
    if (!parsed.name || !parsed.phone) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearCustomer(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
}
