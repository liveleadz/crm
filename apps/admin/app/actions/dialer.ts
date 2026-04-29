'use server';

// Server actions for the WebRTC dialer.
//
// prepareCall:
//   - validates the user, brand, and lead phone
//   - creates a `calls` row with no signalwire_call_id yet
//   - signs a short-lived dial token containing { callId, from, to, exp }
//   - returns the token + the SignalWire Fabric address for the dialer resource

import { revalidatePath } from 'next/cache';
import { getActiveBrand } from '@/lib/active-brand';
import { getMyProfile, getOutboundFromNumber, toE164 } from '@/lib/dialer';
import { signDialToken } from '@/lib/dial-token';
import { createServerClient } from '@leadpilot/db/server';

type PrepareCallResult =
  | {
      ok: true;
      callId: string;
      fabricAddress: string;
      dialToken: string;
      from: string;
      to: string;
      brandName: string;
    }
  | { ok: false; code?: string; error: string };

// Address comes from the SignalWire SWML Webhook resource's default address.
// Confirmed via GET /api/fabric/resources/{id}/addresses on the
// `leadpilot-dialer` resource.
const FABRIC_ADDRESS = '/public/leadpilot-dialer';

export async function prepareCall(input: {
  toNumber: string;
  leadId?: string | null;
}): Promise<PrepareCallResult> {
  if (!process.env.LAML_WEBHOOK_SECRET) {
    return { ok: false, code: 'secret_missing', error: 'LAML_WEBHOOK_SECRET not configured.' };
  }

  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand selected.' };

  const to = toE164(input.toNumber);
  if (!to) return { ok: false, error: 'Enter a valid phone number.' };

  const fromNumber = await getOutboundFromNumber(active.id);
  if (!fromNumber) {
    return {
      ok: false,
      code: 'no_brand_number',
      error: `No outbound number assigned to ${active.name}.`,
    };
  }

  const profile = await getMyProfile();
  if (!profile) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createServerClient();
  const { data: inserted, error: insertErr } = await supabase
    .from('calls')
    .insert({
      brand_id: active.id,
      lead_id: input.leadId ?? null,
      member_id: profile.id,
      number_id: fromNumber.id,
      direction: 'outbound',
      from_number: fromNumber.e164,
      to_number: to,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    return { ok: false, code: 'db_insert_failed', error: insertErr?.message ?? 'Could not log call.' };
  }

  const token = signDialToken({
    callId: inserted.id,
    from: fromNumber.e164,
    to,
    exp: Math.floor(Date.now() / 1000) + 60,
  });

  revalidatePath('/calls');
  return {
    ok: true,
    callId: inserted.id,
    // Token in the address as a fallback. The primary path is
    // userVariables on the dial() call, which we forward in the webhook
    // body — that one survives if SignalWire strips query strings.
    fabricAddress: `${FABRIC_ADDRESS}?channel=audio&t=${encodeURIComponent(token)}`,
    dialToken: token,
    from: fromNumber.e164,
    to,
    brandName: active.name,
  };
}

export async function attachSignalwireCallId(input: {
  callId: string;
  signalwireCallId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('calls')
    .update({ signalwire_call_id: input.signalwireCallId })
    .eq('id', input.callId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function markCallEnded(input: {
  callId: string;
  durationSec?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('calls')
    .update({
      ended_at: new Date().toISOString(),
      duration_sec: input.durationSec ?? null,
    })
    .eq('id', input.callId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calls');
  return { ok: true };
}

export type DispositionCode =
  | 'connected'
  | 'voicemail'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'wrong_number'
  | 'do_not_call'
  | 'callback'
  | 'sale'
  | 'not_interested';

export async function setDisposition(input: {
  callId: string;
  disposition: DispositionCode;
  note?: string | null;
  callbackAt?: string | null; // ISO timestamp when disposition === 'callback'
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('calls')
    .update({
      disposition: input.disposition,
      note: input.note?.trim() ? input.note.trim() : null,
      callback_at: input.disposition === 'callback' ? input.callbackAt ?? null : null,
      needs_disposition: false,
    })
    .eq('id', input.callId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/calls');
  return { ok: true };
}
