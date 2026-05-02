'use server';

// Brand-wide dial policy: per-lead daily attempt cap. Owner/admin only.
// RLS already gates writes on `brands`; we additionally scope by the
// active brand id to prevent cross-brand writes through this action.

import { revalidatePath } from 'next/cache';
import { getActiveBrand } from '@/lib/active-brand';
import { createServerClient } from '@leadpilot/db/server';

type Result = { ok: true } | { ok: false; error: string };

export async function setBrandDialCap(input: { maxPerDay: number | null }): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const v = input.maxPerDay;
  if (v !== null) {
    if (!Number.isInteger(v) || v < 1 || v > 100) {
      return { ok: false, error: 'Cap must be 1–100 calls per lead per day, or empty for no cap.' };
    }
  }

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('brands')
    .update({ max_dials_per_lead_per_day: v })
    .eq('id', active.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/(app)/settings', 'page');
  return { ok: true };
}
