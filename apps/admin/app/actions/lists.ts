'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { slugifyLabel, type SmartListCriteria } from '@/lib/lists';

// Create a custom field definition for the active brand. Returns the slug key.
// If a field with the same key already exists, returns the existing one (idempotent).
export async function createCustomField(input: { label: string }) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const label = input.label.trim();
  if (!label) return { ok: false as const, error: 'Label is required' };
  const key = slugifyLabel(label);
  if (!key) return { ok: false as const, error: 'Label must contain letters or numbers' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  // Upsert by (brand_id, key). If duplicate, return existing.
  const { data: existing } = await supabase
    .from('lead_custom_fields')
    .select('id, key, label')
    .eq('brand_id', active.id)
    .eq('key', key)
    .maybeSingle();
  if (existing) {
    return { ok: true as const, id: existing.id, key: existing.key, label: existing.label };
  }

  const { data, error } = await supabase
    .from('lead_custom_fields')
    .insert({ brand_id: active.id, key, label, created_by: user.id })
    .select('id, key, label')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed' };

  revalidatePath('/pipelines/import');
  return { ok: true as const, id: data.id, key: data.key, label: data.label };
}

export async function renameList(listId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false as const, error: 'Name is required' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('lead_lists')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', listId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  return { ok: true as const };
}

// Delete a list. Leads stay (list_id set to null via FK on delete set null).
export async function deleteList(listId: string) {
  const supabase = await createServerClient();
  const { error } = await supabase.from('lead_lists').delete().eq('id', listId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  return { ok: true as const };
}

// Save the current /leads filter as a named smart list. Stored with
// source='filter' and the filter shape in `criteria` JSONB. Names are
// disambiguated within a brand (the unique index on (brand_id, lower(name))
// rejects duplicates with a clear constraint error).
export async function saveSmartList(input: {
  name: string;
  criteria: SmartListCriteria;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand.' };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: 'Name is required.' };

  // Strip empty/false-y fields so the stored JSON stays minimal and
  // round-trips cleanly through the URL.
  const c = input.criteria;
  const criteria: SmartListCriteria = {};
  if (c.search) criteria.search = c.search;
  if (c.source) criteria.source = c.source;
  if (c.tagIds && c.tagIds.length > 0) criteria.tagIds = c.tagIds;
  if (c.excludeDnc) criteria.excludeDnc = true;
  if (c.excludeDne) criteria.excludeDne = true;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated.' };

  const { data, error } = await supabase
    .from('lead_lists')
    .insert({
      brand_id: active.id,
      name,
      source: 'filter' as const,
      criteria,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) {
    const msg = error?.message ?? 'Insert failed';
    if (msg.includes('lead_lists_brand_name_idx')) {
      return { ok: false as const, error: 'A list with that name already exists.' };
    }
    return { ok: false as const, error: msg };
  }

  revalidatePath('/leads');
  return { ok: true as const, id: data.id };
}

// Overwrite the criteria of an existing filter-source list. Used by the
// "Update list" affordance on /leads when a smart list is pinned and the
// user has tweaked their filters. Brand-scoped, and limited to
// source='filter' rows so we never accidentally repurpose a materialized
// import/manual list.
export async function updateSmartList(input: {
  listId: string;
  criteria: SmartListCriteria;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand.' };

  const c = input.criteria;
  const criteria: SmartListCriteria = {};
  if (c.search) criteria.search = c.search;
  if (c.source) criteria.source = c.source;
  if (c.tagIds && c.tagIds.length > 0) criteria.tagIds = c.tagIds;
  if (c.excludeDnc) criteria.excludeDnc = true;
  if (c.excludeDne) criteria.excludeDne = true;

  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('lead_lists')
    .update({ criteria, updated_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', input.listId)
    .eq('brand_id', active.id)
    .eq('source', 'filter');
  if (error) return { ok: false as const, error: error.message };
  if ((count ?? 0) === 0) {
    return { ok: false as const, error: 'List not found or not a smart list.' };
  }

  revalidatePath('/leads');
  revalidatePath('/pipelines');
  return { ok: true as const };
}

// Bulk delete several smart lists. Brand-scoped via the active brand check
// plus a brand_id filter on the delete itself. Leads belonging to deleted
// lists keep their rows (list_id is FK on delete set null).
export async function bulkDeleteLists(input: { ids: string[] }) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand.' };
  const ids = Array.from(new Set(input.ids.filter(Boolean)));
  if (ids.length === 0) return { ok: true as const, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('lead_lists')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/leads');
  return { ok: true as const, count: count ?? 0 };
}
