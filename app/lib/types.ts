// Mirror of ../../shared/types.ts. Keep them in sync when the schema changes.
// (Duplicated rather than imported so Metro doesn't have to walk outside the
// project root, which is finicky on Windows.)

export type StaffRole = 'barber' | 'admin';
export type EmploymentType = 'full_time' | 'commission';
export type QueueStatus = 'waiting' | 'in_progress' | 'done' | 'cancelled';

export interface Staff {
  id: string;
  auth_user_id: string | null;
  name: string;
  phone: string;
  email: string | null;
  role: StaffRole;
  employment_type: EmploymentType;
  active: boolean;
  base_salary_sen: number | null; // full-time standard monthly base; null = shop default
  created_at: string;
}

export interface ShopSettings {
  id: number;
  full_time_base_salary_sen: number;
  full_time_commission_percent: number;
  commission_only_percent: number;
  updated_at: string;
}

export interface Earning {
  id: string;
  staff_id: string;
  queue_entry_id: string | null;
  amount_sen: number;
  percent_applied: number | null;
  earned_at: string;
}

export interface SalaryPayment {
  staff_id: string;
  period_year: number;
  period_month: number;
  paid: boolean;
  paid_at: string;
  paid_amount_sen: number | null;
  notes: string | null;
  updated_at: string;
}

export interface SalaryOverride {
  staff_id: string;
  period_year: number;
  period_month: number;
  base_sen: number;
  updated_at: string;
}

export interface Service {
  id: string;
  name: string;
  price_sen: number;
  duration_minutes: number;
  active: boolean;
  created_at: string;
}

export interface Product {
  id: string;
  name: string;
  price_sen: number;
  active: boolean;
  created_at: string;
}

export interface Shift {
  id: string;
  staff_id: string;
  started_at: string;
  ended_at: string | null;
}

export interface Break {
  id: string;
  staff_id: string;
  shift_id: string | null;
  requested_at: string;
  started_at: string | null; // null until the queue clears (timer not started yet)
  ended_at: string | null;
  created_at: string;
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
  service_id: string | null; // null = custom service (barber sets price)
  discount_code_id: string | null;
  discount_percent: number | null; // % to apply when a custom price is set
  queue_number: number;
  queue_date: string;
  status: QueueStatus;
  base_price_sen: number | null; // null until a custom-service price is set
  final_price_sen: number | null; // null until a custom-service price is set
  price_adjustment_sen: number;
  cancel_token: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export const formatRM = (sen: number): string => `RM ${(sen / 100).toFixed(2)}`;

export const normalizeMyPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return '60' + digits.slice(1);
  return '60' + digits;
};

export const buildWhatsAppUrl = (phone: string, message: string): string => {
  const normalized = normalizeMyPhone(phone);
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
};

/**
 * Android-only deep link that targets the WhatsApp **Business** app specifically
 * (package com.whatsapp.w4b). Chrome on Android understands `intent://` URLs and
 * routes them to the named package, so this opens Business even when the personal
 * WhatsApp is also installed. If Business isn't installed, browser_fallback_url
 * sends the user to the normal wa.me link instead. iOS has no package selector,
 * so this is for Android (native or web/PWA in Chrome) only.
 */
export const buildWhatsAppBusinessIntent = (phone: string, message: string): string => {
  const normalized = normalizeMyPhone(phone);
  const text = encodeURIComponent(message);
  const fallback = encodeURIComponent(`https://wa.me/${normalized}?text=${text}`);
  return (
    `intent://send?phone=${normalized}&text=${text}` +
    `#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${fallback};end`
  );
};
