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
import { runAutomations } from '@/lib/automation-engine';
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

// Inbound answer: the agent clicked Answer in the IncomingCallPopup. We
// validate that the call belongs to this brand, mint a dial token that
// puts the agent's WebRTC leg into the same conference room as the held
// PSTN caller, and return everything the dialer client needs to bridge.
export async function prepareInboundAnswer(input: {
  callId: string;
}): Promise<
  | {
      ok: true;
      fabricAddress: string;
      dialToken: string;
      conference: string;
    }
  | { ok: false; error: string }
> {
  if (!process.env.LAML_WEBHOOK_SECRET) {
    return { ok: false, error: 'LAML_WEBHOOK_SECRET not configured.' };
  }
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { data: call } = await supabase
    .from('calls')
    .select('id, brand_id, direction, from_number, to_number')
    .eq('id', input.callId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!call) return { ok: false, error: 'Call not found.' };
  if (call.direction !== 'inbound') {
    return { ok: false, error: 'Not an inbound call.' };
  }
  // Stamp ownership so /calls reflects who picked it up.
  const profile = await getMyProfile();
  if (profile) {
    await supabase
      .from('calls')
      .update({ member_id: profile.id })
      .eq('id', call.id);
  }
  const conference = `inbound-${call.id}`;
  const token = signDialToken({
    callId: call.id,
    from: call.from_number,
    to: '',
    exp: Math.floor(Date.now() / 1000) + 60,
    conference,
  });
  return {
    ok: true,
    fabricAddress: `${FABRIC_ADDRESS}?channel=audio&t=${encodeURIComponent(token)}`,
    dialToken: token,
    conference,
  };
}

// Mark a notification (typically the inbound_call popup row) as read so the
// bell badge updates and the popup doesn't re-show on reload.
export async function markNotificationHandled(input: {
  notificationId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', input.notificationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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

// Disposition codes are now data — managers configure them per brand
// in /settings. We keep the string permissive here; existing rows with
// the old hardcoded codes (connected, callback, etc.) remain valid.
export async function setDisposition(input: {
  callId: string;
  disposition: string;
  note?: string | null;
  callbackAt?: string | null; // ISO timestamp when disposition === 'callback'
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const callbackAt =
    input.disposition === 'callback' ? input.callbackAt ?? null : null;
  const { data: row, error } = await supabase
    .from('calls')
    .update({
      disposition: input.disposition,
      note: input.note?.trim() ? input.note.trim() : null,
      callback_at: callbackAt,
      needs_disposition: false,
    })
    .eq('id', input.callId)
    .select('brand_id, lead_id, member_id')
    .single();
  if (error) return { ok: false, error: error.message };

  // Fan out to user-defined automations. Best-effort: a misbehaving rule
  // must never reject the disposition save.
  if (row) {
    await runAutomations({
      trigger: 'disposition_set',
      brandId: row.brand_id,
      callId: input.callId,
      leadId: row.lead_id,
      memberId: row.member_id,
      disposition: input.disposition,
      callbackAt,
    });
  }

  revalidatePath('/calls');
  revalidatePath('/leads');
  revalidatePath('/tasks');
  return { ok: true };
}
