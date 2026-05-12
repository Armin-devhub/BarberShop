// Shared types between the customer web (Next.js) and staff/admin app (Expo).
// Mirrors the Postgres schema in supabase/migrations.

export type StaffRole = 'barber' | 'admin';

export type QueueStatus = 'waiting' | 'in_progress' | 'done' | 'cancelled';

export interface Staff {
  id: string;
  auth_user_id: string | null;
  name: string;
  phone: string;
  role: StaffRole;
  active: boolean;
  created_at: string;
}

export interface Service {
  id: string;
  name: string;
  price_sen: number;
  duration_minutes: number;
  active: boolean;
  created_at: string;
}

export interface Shift {
  id: string;
  staff_id: string;
  started_at: string;
  ended_at: string | null;
}

export interface ShiftService {
  shift_id: string;
  service_id: string;
}

export interface DiscountCode {
  id: string;
  code: string;
  percent: number;
  max_uses: number | null;
  used_count: number;
  expires_at: string | null;
  active: boolean;
  created_at: string;
  created_by: string | null;
}

export interface QueueEntry {
  id: string;
  staff_id: string;
  shift_id: string | null;
  customer_name: string;
  customer_phone: string;
  service_id: string;
  discount_code_id: string | null;
  queue_number: number;
  queue_date: string;
  status: QueueStatus;
  base_price_sen: number;
  final_price_sen: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

// Shape returned to anon clients (customer_phone and discount_code_id revoked).
export type PublicQueueEntry = Omit<QueueEntry, 'customer_phone' | 'discount_code_id'>;

export interface BarberOnShift {
  shift_id: string;
  started_at: string;
  staff_id: string;
  staff_name: string;
  waiting_count: number;
}

export interface BarberShiftService {
  shift_id: string;
  staff_id: string;
  staff_name: string;
  service_id: string;
  service_name: string;
  price_sen: number;
  duration_minutes: number;
}

export interface DiscountPreview {
  valid: boolean;
  percent: number | null;
  base_price_sen: number | null;
  final_price_sen: number | null;
  message: string;
}

// Helpers
export const formatRM = (sen: number): string => `RM ${(sen / 100).toFixed(2)}`;

/**
 * Normalize a Malaysian phone number for use in wa.me URLs.
 * Accepts: "0123456789", "+60123456789", "60 12 345 6789", "123456789"
 * Returns: "60123456789" (digits only, with country code)
 */
export const normalizeMyPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return '60' + digits.slice(1);
  return '60' + digits;
};

/**
 * Build a wa.me URL with a pre-filled message. The customer's phone (already
 * normalized) goes in the URL; staff taps Send in their phone's WhatsApp app.
 */
export const buildWhatsAppUrl = (phone: string, message: string): string => {
  const normalized = normalizeMyPhone(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
};
