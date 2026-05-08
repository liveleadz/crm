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
//
// Uses the admin client because `numbers` reads are now manager+ only
// (migration 0043). Agents legitimately need to know their outbound
// caller ID to dial — but they should not be able to enumerate the
// numbers table directly. This server-only helper bridges that gap.
export async function getOutboundFromNumber(
  brandId: string,
): Promise<OutboundFromNumber | null> {
  const supabase = createAdminClient();
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

// Make sure the call has a lead attached, creating one on the fly if it
// doesn't. This is what lets disposition automations fire on ad-hoc dials
// to numbers that aren't in the contacts list yet — the seeded
// "Sale → move to Won" / "DNC → mark Do Not Call" / etc. rules all
// require ctx.leadId, so without a lead they silently no-op.
//
// Idempotent and concurrent-safe: re-runs against the same callId will
// return the existing lead_id rather than minting duplicates. We also
// re-check the brand-wide phone index right before inserting in case
// another path (e.g. inbound webhook) just resolved the same lead.
//
// Uses the admin client because: (a) the call's owner may not have RLS
// rights to insert leads, (b) we backfill calls.lead_id which the agent
// also might not own under the role-scoped RLS from migration 0040.
export async function ensureLeadForCall(callId: string): Promise<string | null> {
  const sb = createAdminClient();
  const { data: call } = await sb
    .from('calls')
    .select('id, brand_id, lead_id, member_id, direction, from_number, to_number')
    .eq('id', callId)
    .maybeSingle();
  if (!call) return null;
  if (call.lead_id) return call.lead_id;

  // Outbound: dialed-out number is the contact. Inbound: caller is.
  const otherSide = call.direction === 'inbound' ? call.from_number : call.to_number;
  if (!otherSide || otherSide === 'unknown') return null;
  const e164 = toE164(otherSide) ?? otherSide;

  // Last-chance lookup before insert. Covers the race where the inbound
  // webhook + the agent's wrap-up both try to materialize the same lead.
  const existing = await findBrandLeadByPhone(call.brand_id, e164);
  if (existing) {
    await sb.from('calls').update({ lead_id: existing.id }).eq('id', callId);
    // Claim ownership for the calling agent if the lead is currently
    // unowned. Without this, the agent who actually worked the lead
    // can't see it in their pipeline — leads_select RLS only lets agents
    // see leads where owner_id = their uid (or that they're assigned to
    // via campaign_agents). Manager+ already saw it through the
    // is_manager_or_above branch, which is why the brand owner had it
    // on their kanban while the responsible agent didn't. We never
    // overwrite an existing owner_id so we don't yank a lead away from
    // a different agent who's already working it.
    if (call.member_id) {
      await sb
        .from('leads')
        .update({ owner_id: call.member_id })
        .eq('id', existing.id)
        .is('owner_id', null);
    }
    return existing.id;
  }

  // Drop the new lead on the brand's first pipeline stage so it shows up
  // in the kanban under "New" (or whatever the manager named position 0).
  // Falling back to null is fine — the seeded automations move the lead
  // to its correct destination stage immediately after this anyway.
  const { data: firstStage } = await sb
    .from('stages')
    .select('id')
    .eq('brand_id', call.brand_id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await sb
    .from('leads')
    .insert({
      brand_id: call.brand_id,
      stage_id: firstStage?.id ?? null,
      // Owner the lead to whoever placed/took the call so it shows up
      // in their assigned-to-me views and respects the leads_select RLS
      // self-scope for agents.
      owner_id: call.member_id ?? null,
      source: 'manual',
      phone: e164,
    })
    .select('id')
    .single();
  if (error || !created) return null;

  await sb.from('calls').update({ lead_id: created.id }).eq('id', callId);
  return created.id;
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
