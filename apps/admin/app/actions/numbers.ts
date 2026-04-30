'use server';

// CRUD for /numbers. The bulk-sync-from-SignalWire action was removed
// intentionally to prevent accidentally importing every number on the
// SignalWire project (some of which may belong to another dialer). Numbers
// are now added by hand or by reusing the existing import workflow.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

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
