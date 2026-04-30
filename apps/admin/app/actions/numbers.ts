'use server';

// CRUD for /numbers. The bulk-sync-from-SignalWire action was removed
// intentionally to prevent accidentally importing every number on the
// SignalWire project (some of which may belong to another dialer). Numbers
// are now added by hand or by reusing the existing import workflow.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import {
  findIncomingPhoneNumberSid,
  lookupCnam,
  setIncomingPhoneNumberVoiceUrl,
} from '@/lib/signalwire';
import { getPublicAppUrl } from '@/lib/dialer';

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Inbound routing per number
// ---------------------------------------------------------------------------

export type InboundRouteRow = {
  numberId: string;
  strategy: 'simul' | 'round_robin' | 'single';
  memberIds: string[];
  ringTimeoutSec: number;
  voicemailEnabled: boolean;
  voicemailGreeting: string | null;
};

export async function loadInboundRoute(numberId: string): Promise<InboundRouteRow | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('inbound_routes')
    .select('number_id, strategy, member_ids, ring_timeout_sec, voicemail_enabled, voicemail_greeting')
    .eq('number_id', numberId)
    .maybeSingle();
  if (!data) return null;
  return {
    numberId: data.number_id,
    strategy: data.strategy as InboundRouteRow['strategy'],
    memberIds: (data.member_ids as string[] | null) ?? [],
    ringTimeoutSec: data.ring_timeout_sec,
    voicemailEnabled: data.voicemail_enabled,
    voicemailGreeting: data.voicemail_greeting,
  };
}

export async function saveInboundRoute(input: {
  numberId: string;
  strategy: 'simul' | 'round_robin' | 'single';
  memberIds: string[];
  ringTimeoutSec: number;
  voicemailEnabled: boolean;
  voicemailGreeting?: string | null;
}): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { data: num } = await supabase
    .from('numbers')
    .select('id')
    .eq('id', input.numberId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!num) return { ok: false, error: 'Number not found in this brand.' };

  const ring = Math.max(5, Math.min(120, Math.trunc(input.ringTimeoutSec) || 25));
  const memberIds = Array.from(new Set(input.memberIds.filter(Boolean)));

  const { error } = await supabase.from('inbound_routes').upsert(
    {
      number_id: input.numberId,
      brand_id: active.id,
      strategy: input.strategy,
      member_ids: memberIds,
      ring_timeout_sec: ring,
      voicemail_enabled: input.voicemailEnabled,
      voicemail_greeting: input.voicemailGreeting?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'number_id' },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  return { ok: true };
}

export async function deleteInboundRoute(input: { numberId: string }): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('inbound_routes')
    .delete()
    .eq('number_id', input.numberId)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Carrier wiring — point the upstream voice handler at our SWML route so
// inbound calls reach the platform. Stores `inbound_connected_at` on success
// so the UI can render a "Connected" pill.
// ---------------------------------------------------------------------------

export async function connectInboundNumber(input: {
  numberId: string;
}): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { data: num } = await supabase
    .from('numbers')
    .select('id, e164, signalwire_id')
    .eq('id', input.numberId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!num) return { ok: false, error: 'Number not found in this brand.' };

  // Resolve provider SID (cache on numbers.signalwire_id once we have it).
  let sid = num.signalwire_id;
  if (!sid) {
    const lookup = await findIncomingPhoneNumberSid(num.e164);
    if (!lookup.ok) return { ok: false, error: lookup.error };
    if (!lookup.data) {
      return {
        ok: false,
        error: 'Number is not provisioned upstream. Buy or port it first.',
      };
    }
    sid = lookup.data;
  }

  const voiceUrl = `${getPublicAppUrl()}/api/swml/inbound/${encodeURIComponent(num.e164)}`;
  const update = await setIncomingPhoneNumberVoiceUrl({ sid, voiceUrl });
  if (!update.ok) return { ok: false, error: update.error };

  await supabase
    .from('numbers')
    .update({
      signalwire_id: sid,
      inbound_connected_at: new Date().toISOString(),
    })
    .eq('id', input.numberId);

  revalidatePath('/numbers');
  return { ok: true };
}

export async function disconnectInboundNumber(input: {
  numberId: string;
}): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { data: num } = await supabase
    .from('numbers')
    .select('id, e164, signalwire_id')
    .eq('id', input.numberId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!num) return { ok: false, error: 'Number not found in this brand.' };
  if (!num.signalwire_id) {
    // Nothing to undo; just clear our flag.
    await supabase
      .from('numbers')
      .update({ inbound_connected_at: null })
      .eq('id', input.numberId);
    revalidatePath('/numbers');
    return { ok: true };
  }
  // Clearing voice_url tells the carrier to stop forwarding inbound to us.
  const update = await setIncomingPhoneNumberVoiceUrl({
    sid: num.signalwire_id,
    voiceUrl: '',
  });
  if (!update.ok) return { ok: false, error: update.error };
  await supabase
    .from('numbers')
    .update({ inbound_connected_at: null })
    .eq('id', input.numberId);
  revalidatePath('/numbers');
  return { ok: true };
}

// SignalWire's Lookup API charges ~$0.005 per CNAM hit, so this stays
// strictly on-demand — one lookup per click, cached on the row.
export async function refreshCnam(input: {
  id: string;
}): Promise<Result<{ cnam: string | null }>> {
  const supabase = await createServerClient();
  const { data: row } = await supabase
    .from('numbers')
    .select('id, e164')
    .eq('id', input.id)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Number not found.' };

  const lookup = await lookupCnam(row.e164);
  if (!lookup.ok) return { ok: false, error: lookup.error };

  const cnam = lookup.data.caller_name?.trim() || null;
  const { error } = await supabase
    .from('numbers')
    .update({ cnam, cnam_checked_at: new Date().toISOString() })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/numbers');
  return { ok: true, cnam };
}

export async function updateNumberLabel(input: {
  id: string;
  label: string | null;
}): Promise<Result> {
  const supabase = await createServerClient();
  const label = input.label?.trim() || null;
  const { error } = await supabase
    .from('numbers')
    .update({ label })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  return { ok: true };
}

export async function setNumberActive(input: {
  id: string;
  active: boolean;
}): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('numbers')
    .update({ active: input.active })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  return { ok: true };
}

export async function setA2pCampaignId(input: {
  id: string;
  campaignId: string | null;
}): Promise<Result> {
  const supabase = await createServerClient();
  const a2p = input.campaignId?.trim() || null;
  const { error } = await supabase
    .from('numbers')
    .update({ a2p_campaign_id: a2p })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  return { ok: true };
}

export async function deleteNumber(input: { id: string }): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase.from('numbers').delete().eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  return { ok: true };
}

export async function bulkDeleteNumbers(input: {
  ids: string[];
}): Promise<Result<{ count: number }>> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('numbers')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  return { ok: true, count: count ?? 0 };
}
