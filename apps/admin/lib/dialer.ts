// Server-only helpers for the outbound dialer.
import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';

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

// Resolve a brand-scoped lead by phone, tolerating the formats lead phones
// actually show up in: E.164 (canonical), E.164 without the leading "+",
// and bare 10-digit US/CA national. We rely on this for both ad-hoc
// outbound dials (keypad without an explicit leadId) and inbound webhook
// attribution — without it, calls land with lead_id=null and every
// downstream automation that's leadBound (move_stage, mark_dnc, add_tag,
// create_task, update_lead_field) silently no-ops because executeAction
// short-circuits on a missing ctx.leadId. That's exactly why the seeded
// "Sale → move to Won" rule was failing for the user.
//
// Uses the admin client on purpose: an agent dialing a number whose
// matching lead they don't own would otherwise be filtered out by the
// leads_select RLS policy (manager+/owner/campaign-assigned only). The
// lookup is a read-only brand-scoped resolution, so this is safe.
export async function findBrandLeadByPhone(
  brandId: string,
  e164: string,
): Promise<{ id: string } | null> {
  const variants = new Set<string>([e164]);
  if (e164.startsWith('+')) variants.add(e164.slice(1));
  const digits = e164.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) variants.add(digits.slice(1));
  if (digits.length === 10) variants.add(digits);

  const sb = createAdminClient();
  const { data } = await sb
    .from('leads')
    .select('id')
    .eq('brand_id', brandId)
    .in('phone', Array.from(variants))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export function getPublicAppUrl(): string {
  // Only trust NEXT_PUBLIC_APP_URL if it actually parses as an http(s) URL.
  // (Some Vercel projects ship with the literal placeholder string baked in,
  // which then gets used as a webhook URL and SignalWire rejects record_call
  // status_url as "invalid value".)
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && /^https?:\/\//.test(explicit)) return explicit.replace(/\/$/, '');
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProd) return `https://${vercelProd}`;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return 'http://localhost:3000';
}
