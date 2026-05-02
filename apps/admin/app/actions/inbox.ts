'use server';

// Inbox triage actions. Mark a call handled (default = current member)
// or revert to unhandled. RLS already scopes the calls table to brand
// members; we re-check brand membership defensively and then update.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { getMyProfile } from '@/lib/dialer';

type Result = { ok: true } | { ok: false; error: string };

export async function markCallHandled(callId: string): Promise<Result> {
  try {
    const active = await getActiveBrand();
    if (!active) return { ok: false, error: 'No active brand.' };
    const me = await getMyProfile();
    if (!me) return { ok: false, error: 'Not signed in.' };
    const supabase = await createServerClient();
    const { error } = await supabase
      .from('calls')
      .update({ handled_at: new Date().toISOString(), handled_by: me.id })
      .eq('id', callId)
      .eq('brand_id', active.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/inbox');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed.' };
  }
}

export async function markCallUnhandled(callId: string): Promise<Result> {
  try {
    const active = await getActiveBrand();
    if (!active) return { ok: false, error: 'No active brand.' };
    const supabase = await createServerClient();
    const { error } = await supabase
      .from('calls')
      .update({ handled_at: null, handled_by: null })
      .eq('id', callId)
      .eq('brand_id', active.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/inbox');
    revalidatePath('/dashboard');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed.' };
  }
}
