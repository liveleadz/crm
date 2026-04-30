'use server';

// CRUD + sync for /numbers. The sync action pulls phone numbers from the
// SignalWire account and upserts them into the brand's `numbers` table so
// admins don't have to copy E.164 strings from the SignalWire console.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { listSignalWirePhoneNumbers } from '@/lib/signalwire';

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export async function syncSignalWireNumbers(): Promise<
  Result<{ added: number; updated: number; total: number }>
> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const sw = await listSignalWirePhoneNumbers();
  if (!sw.ok) return { ok: false, error: sw.error };

  const supabase = await createServerClient();
  const { data: existing } = await supabase
    .from('numbers')
    .select('id, e164, signalwire_id')
    .eq('brand_id', active.id);

  const byE164 = new Map((existing ?? []).map((r) => [r.e164, r]));
  let added = 0;
  let updated = 0;

  for (const n of sw.data) {
    if (!n.number) continue;
    const e164 = n.number.startsWith('+') ? n.number : `+${n.number.replace(/\D/g, '')}`;
    const found = byE164.get(e164);
    if (!found) {
      const { error } = await supabase.from('numbers').insert({
        brand_id: active.id,
        e164,
        signalwire_id: n.id,
        label: n.name ?? null,
        active: true,
      });
      if (!error) added++;
    } else if (found.signalwire_id !== n.id) {
      // Backfill the SignalWire id so future renames/deletions can be reconciled.
      const { error } = await supabase
        .from('numbers')
        .update({ signalwire_id: n.id })
        .eq('id', found.id);
      if (!error) updated++;
    }
  }

  revalidatePath('/numbers');
  return { ok: true, added, updated, total: sw.data.length };
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
