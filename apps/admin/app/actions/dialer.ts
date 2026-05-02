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

// Claim the most recent inbound call for the active brand for the current
// member. Used by the IncomingCallPopup to map an SDK invite back to our
// internal call row so disposition/note can be saved against the right
// call when the agent hangs up.
export async function claimRecentInboundCall(): Promise<
  | {
      ok: true;
      callId: string;
      fromNumber: string;
      toNumber: string;
      leadId: string | null;
      leadName: string | null;
    }
  | { ok: false; error: string }
> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const profile = await getMyProfile();
  if (!profile) return { ok: false, error: 'Not authenticated.' };
  const supabase = await createServerClient();
  const since = new Date(Date.now() - 120_000).toISOString();
  const { data: call } = await supabase
    .from('calls')
    .select('id, from_number, to_number, lead_id, leads(first_name, last_name)')
    .eq('brand_id', active.id)
    .eq('direction', 'inbound')
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!call) return { ok: false, error: 'No recent inbound call.' };
  await supabase
    .from('calls')
    .update({ member_id: profile.id, needs_disposition: true })
    .eq('id', call.id);
  // Clear the "Missed call" notifications for THIS call across all
  // recipients — an answered call should never show as missed in the bell.
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('brand_id', active.id)
    .eq('kind', 'inbound_call')
    .contains('data', { call_id: call.id });
  const lead = call.leads as { first_name: string | null; last_name: string | null } | null;
  const leadName = lead
    ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
    : null;
  return {
    ok: true,
    callId: call.id,
    fromNumber: call.from_number,
    toNumber: call.to_number,
    leadId: call.lead_id,
    leadName,
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
  const { data: row, error } = await supabase
    .from('calls')
    .update({
      ended_at: new Date().toISOString(),
      duration_sec: input.durationSec ?? null,
    })
    .eq('id', input.callId)
    .select('brand_id, lead_id, member_id, direction')
    .single();
  if (error) return { ok: false, error: error.message };

  // Fan out call_ended automations. Best-effort.
  if (row && (row.direction === 'inbound' || row.direction === 'outbound')) {
    void runAutomations({
      trigger: 'call_ended',
      brandId: row.brand_id,
      leadId: row.lead_id,
      memberId: row.member_id,
      callId: input.callId,
      direction: row.direction,
      durationSec: input.durationSec ?? null,
    });
  }

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

// Bulk re-disposition for the /calls list. Applies a single disposition
// code to many calls at once — useful for cleaning up a batch of "needs
// disposition" rows or correcting a misclick. Note + callback_at are not
// settable in bulk mode (would conflict per-row); they're cleared so the
// new disposition isn't paired with a stale note.
export async function bulkSetDispositions(input: {
  callIds: string[];
  disposition: string;
}): Promise<
  | { ok: true; updated: number }
  | { ok: false; error: string }
> {
  if (input.callIds.length === 0) {
    return { ok: false, error: 'No calls selected.' };
  }
  if (!input.disposition) {
    return { ok: false, error: 'Pick a disposition first.' };
  }
  const supabase = await createServerClient();
  // Brand scope is enforced by RLS on `calls`; we just update by id list.
  const { data: rows, error } = await supabase
    .from('calls')
    .update({
      disposition: input.disposition,
      callback_at: null,
      needs_disposition: false,
    })
    .in('id', input.callIds)
    .select('id, brand_id, lead_id, member_id');
  if (error) return { ok: false, error: error.message };
  const updated = rows?.length ?? 0;

  // Fan out automations per row, best-effort.
  if (rows && rows.length > 0) {
    await Promise.all(
      rows.map((r) =>
        runAutomations({
          trigger: 'disposition_set',
          brandId: r.brand_id,
          callId: r.id,
          leadId: r.lead_id,
          memberId: r.member_id,
          disposition: input.disposition,
          callbackAt: null,
        }).catch(() => undefined),
      ),
    );
  }

  revalidatePath('/calls');
  revalidatePath('/leads');
  revalidatePath('/tasks');
  return { ok: true, updated };
}
