'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';

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
