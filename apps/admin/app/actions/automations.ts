'use server';

// CRUD actions for per-brand automations. Owner/admin only — RLS enforces
// at the database layer; we still gate `getActiveBrand()` so we never
// operate on the wrong brand.

import { revalidatePath } from 'next/cache';
import { getActiveBrand } from '@/lib/active-brand';
import { createServerClient } from '@leadpilot/db/server';
import type { Json } from '@leadpilot/db/types';
import type { AutomationAction } from '@/lib/automations';

type Result = { ok: true; id?: string } | { ok: false; error: string };

function validateActions(actions: unknown): actions is AutomationAction[] {
  if (!Array.isArray(actions)) return false;
  return actions.every((a) => {
    if (!a || typeof a !== 'object') return false;
    const k = (a as { kind?: unknown }).kind;
    return (
      k === 'move_stage' ||
      k === 'mark_dnc' ||
      k === 'add_tag' ||
      k === 'create_task'
    );
  });
}

export async function createAutomation(input: {
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actions: AutomationAction[];
}): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!validateActions(input.actions)) return { ok: false, error: 'Invalid actions.' };
  if (input.actions.length === 0) return { ok: false, error: 'Add at least one action.' };

  const supabase = await createServerClient();
  const { data: maxRow } = await supabase
    .from('automations')
    .select('sort_order')
    .eq('brand_id', active.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 10;

  const { data, error } = await supabase
    .from('automations')
    .insert({
      brand_id: active.id,
      name,
      description: input.description?.trim() || null,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig as unknown as Json,
      actions: input.actions as unknown as Json,
      sort_order: nextSort,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  revalidatePath('/workflows');
  return { ok: true, id: data.id };
}

export async function updateAutomation(input: {
  id: string;
  name: string;
  description?: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actions: AutomationAction[];
}): Promise<Result> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Name is required.' };
  if (!validateActions(input.actions)) return { ok: false, error: 'Invalid actions.' };
  if (input.actions.length === 0) return { ok: false, error: 'Add at least one action.' };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('automations')
    .update({
      name,
      description: input.description?.trim() || null,
      trigger_type: input.triggerType,
      trigger_config: input.triggerConfig as unknown as Json,
      actions: input.actions as unknown as Json,
    })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true };
}

export async function setAutomationEnabled(input: {
  id: string;
  enabled: boolean;
}): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('automations')
    .update({ is_enabled: input.enabled })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true };
}

export async function deleteAutomation(input: { id: string }): Promise<Result> {
  const supabase = await createServerClient();
  // System automations are deletable too — they're seeded once and managers
  // can prune anything they don't want. The is_system flag is informational
  // (drives the "default" badge in the UI).
  const { error } = await supabase.from('automations').delete().eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/workflows');
  return { ok: true };
}

export async function reorderAutomations(input: { ids: string[] }): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const supabase = await createServerClient();
  for (let i = 0; i < input.ids.length; i++) {
    const id = input.ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from('automations')
      .update({ sort_order: (i + 1) * 10 })
      .eq('id', id)
      .eq('brand_id', active.id);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/workflows');
  return { ok: true };
}
