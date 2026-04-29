// Server-only helpers for the outbound dialer.
import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type OutboundFromNumber = {
  id: string;
  e164: string;
  label: string | null;
};

// First active number for the given brand. The MVP uses a single outbound
// caller ID per brand; we pick the oldest active one deterministically.
export async function getOutboundFromNumber(
  brandId: string,
): Promise<OutboundFromNumber | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('numbers')
    .select('id, e164, label')
    .eq('brand_id', brandId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function getMyProfile(): Promise<{
  id: string;
  email: string;
  fullName: string | null;
  mobilePhone: string | null;
} | null> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('members')
    .select('id, email, full_name, mobile_phone')
    .eq('id', user.id)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    mobilePhone: data.mobile_phone,
  };
}

// Lightweight E.164 normalizer. Strips formatting, defaults +1 for 10-digit
// numbers (US/CA). Returns null when input clearly isn't a phone number.
export function toE164(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) {
    const rest = digits.slice(1).replace(/\D/g, '');
    if (rest.length < 7) return null;
    return `+${rest}`;
  }
  const stripped = digits.replace(/\D/g, '');
  if (stripped.length === 10) return `+1${stripped}`;
  if (stripped.length === 11 && stripped.startsWith('1')) return `+${stripped}`;
  return null;
}

export function getPublicAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}
