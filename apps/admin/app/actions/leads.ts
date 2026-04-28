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
