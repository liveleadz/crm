'use server';

// CRUD for outbound caller-ID pools. Manager+ guard via RLS on
// phone_pools / phone_pool_numbers; this layer just shapes errors and
// revalidates the surfaces that surface pool data (numbers manager,
// campaign editor).

import { revalidatePath } from 'next/cache';
import { getActiveBrand } from '@/lib/active-brand';
import { createServerClient } from '@leadpilot/db/server';
import type { PoolStrategy } from '@/lib/phone-pools';

type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

export async function createPool(input: {
  name: string;
  strategy?: PoolStrategy;
}): Promise<Result<{ poolId: string }>> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Pool name is required.' };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('phone_pools')
    .insert({
      brand_id: active.id,
      name,
      strategy: input.strategy ?? 'round_robin',
    })
    .select('id')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Insert failed.' };
  revalidatePath('/numbers');
  return { ok: true, poolId: data.id };
}

export async function updatePool(input: {
  poolId: string;
  name?: string;
  strategy?: PoolStrategy;
}): Promise<Result> {
  const supabase = await createServerClient();
  const patch: { name?: string; strategy?: PoolStrategy } = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, error: 'Pool name is required.' };
    patch.name = trimmed;
  }
  if (input.strategy !== undefined) patch.strategy = input.strategy;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase
    .from('phone_pools')
    .update(patch)
    .eq('id', input.poolId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  revalidatePath('/campaigns');
  return { ok: true };
}

export async function deletePool(poolId: string): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase.from('phone_pools').delete().eq('id', poolId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  revalidatePath('/campaigns');
  return { ok: true };
}

// Replace pool members in one shot. Simpler for the editor UI than a
// per-row add/remove action; the row count never gets large enough for
// the diff to matter.
export async function setPoolMembers(input: {
  poolId: string;
  numberIds: string[];
}): Promise<Result> {
  const supabase = await createServerClient();
  const { error: delErr } = await supabase
    .from('phone_pool_numbers')
    .delete()
    .eq('pool_id', input.poolId);
  if (delErr) return { ok: false, error: delErr.message };
  if (input.numberIds.length > 0) {
    const rows = Array.from(new Set(input.numberIds)).map((id) => ({
      pool_id: input.poolId,
      number_id: id,
    }));
    const { error } = await supabase.from('phone_pool_numbers').insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/numbers');
  return { ok: true };
}

export async function setBrandDefaultPool(
  poolId: string | null,
): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('brands')
    .update({ default_pool_id: poolId })
    .eq('id', active.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/numbers');
  return { ok: true };
}

export async function setCampaignPool(input: {
  campaignId: string;
  poolId: string | null;
}): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('campaigns')
    .update({ phone_pool_id: input.poolId })
    .eq('id', input.campaignId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/campaigns');
  return { ok: true };
}
