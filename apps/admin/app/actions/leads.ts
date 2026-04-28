'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { loadLeadDetail } from '@/lib/leads';

export async function moveLeadStage(leadId: string, stageId: string) {
  const supabase = await createServerClient();
  // RLS scopes the update; if the user can't access the lead the row count is 0.
  const { error } = await supabase
    .from('leads')
    .update({ stage_id: stageId, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  return { ok: true as const };
}

export async function getLeadDetail(leadId: string) {
  const active = await getActiveBrand();
  if (!active) return null;
  return loadLeadDetail(leadId, active.id);
}

export async function updateLeadNotes(leadId: string, notes: string) {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('leads')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', leadId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  return { ok: true as const };
}

export type CallDirection = 'outbound' | 'inbound';
export type CallDisposition =
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

export async function logCall(input: {
  leadId: string;
  direction: CallDirection;
  disposition: CallDisposition;
  durationSec?: number | null;
  notes?: string | null;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  // Fetch lead phone to use as the counterparty number for manual logs.
  const { data: lead } = await supabase
    .from('leads')
    .select('phone')
    .eq('id', input.leadId)
    .eq('brand_id', active.id)
    .maybeSingle();
  if (!lead) return { ok: false as const, error: 'Lead not found' };

  const leadNumber = lead.phone ?? 'manual';
  const startedAt = new Date();
  const endedAt =
    input.durationSec && input.durationSec > 0
      ? new Date(startedAt.getTime() + input.durationSec * 1000).toISOString()
      : null;

  const { data: call, error } = await supabase
    .from('calls')
    .insert({
      brand_id: active.id,
      lead_id: input.leadId,
      member_id: user.id,
      direction: input.direction,
      disposition: input.disposition,
      duration_sec: input.durationSec ?? null,
      from_number: input.direction === 'outbound' ? 'manual' : leadNumber,
      to_number: input.direction === 'outbound' ? leadNumber : 'manual',
      started_at: startedAt.toISOString(),
      ended_at: endedAt,
      transcript: input.notes ?? null,
    })
    .select('id')
    .single();
  if (error || !call) return { ok: false as const, error: error?.message ?? 'Insert failed' };

  await supabase.from('lead_events').insert({
    brand_id: active.id,
    lead_id: input.leadId,
    member_id: user.id,
    type: 'call_logged',
    payload: {
      call_id: call.id,
      direction: input.direction,
      disposition: input.disposition,
      duration_sec: input.durationSec ?? null,
    },
  });

  await supabase
    .from('leads')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.leadId);

  revalidatePath('/leads');
  revalidatePath('/dashboard');
  revalidatePath('/calls');
  return { ok: true as const, callId: call.id };
}

export async function setLeadConsent(
  leadId: string,
  consent: { doNotCall?: boolean; doNotEmail?: boolean },
) {
  const supabase = await createServerClient();
  const patch: { updated_at: string; do_not_call?: boolean; do_not_email?: boolean } = {
    updated_at: new Date().toISOString(),
  };
  if (consent.doNotCall !== undefined) patch.do_not_call = consent.doNotCall;
  if (consent.doNotEmail !== undefined) patch.do_not_email = consent.doNotEmail;
  const { error } = await supabase.from('leads').update(patch).eq('id', leadId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  return { ok: true as const };
}
