'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { loadBrandTags, loadLeadTags, type Tag } from '@/lib/tags';

// Palette keys recognised by the frontend chip renderer. We round-robin assign
// when callers don't pass a color so newly-created tags get visual variety.
const PALETTE = [
  'teal',
  'blue',
  'amber',
  'rose',
  'purple',
  'green',
  'orange',
  'pink',
  'slate',
] as const;

function pickColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? 'slate';
}

function bumpLead(leadId: string | null) {
  revalidatePath('/leads');
  revalidatePath('/dashboard');
  revalidatePath('/tasks');
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

export async function getBrandTags(): Promise<Tag[]> {
  const active = await getActiveBrand();
  if (!active) return [];
  return loadBrandTags(active.id);
}

export async function getLeadTags(leadId: string): Promise<Tag[]> {
  return loadLeadTags(leadId);
}

// Find an existing tag for this brand (case-insensitive) or create it.
// Single source of truth used by inline picker and CSV import.
export async function getOrCreateTag(name: string, color?: string) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false as const, error: 'Tag name is required' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const { data: existing } = await supabase
    .from('tags')
    .select('id, name, color')
    .eq('brand_id', active.id)
    .ilike('name', trimmed)
    .maybeSingle();
  if (existing) {
    return {
      ok: true as const,
      tag: { id: existing.id, name: existing.name, color: existing.color ?? 'slate' },
      created: false as const,
    };
  }

  const { data, error } = await supabase
    .from('tags')
    .insert({
      brand_id: active.id,
      name: trimmed,
      color: color ?? pickColor(trimmed),
      created_by: user.id,
    })
    .select('id, name, color')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed' };
  revalidatePath('/leads');
  return {
    ok: true as const,
    tag: { id: data.id, name: data.name, color: data.color ?? 'slate' },
    created: true as const,
  };
}

export async function addTagToLead(leadId: string, tagId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };
  // Ignore duplicate insert (composite PK collision).
  const { error } = await supabase
    .from('lead_tags')
    .insert({ lead_id: leadId, tag_id: tagId, created_by: user.id });
  if (error && !/duplicate/i.test(error.message)) {
    return { ok: false as const, error: error.message };
  }
  bumpLead(leadId);
  return { ok: true as const };
}

export async function removeTagFromLead(leadId: string, tagId: string) {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('lead_tags')
    .delete()
    .eq('lead_id', leadId)
    .eq('tag_id', tagId);
  if (error) return { ok: false as const, error: error.message };
  bumpLead(leadId);
  return { ok: true as const };
}

// Inline shortcut: create-if-missing then attach. Returns the resolved tag.
export async function attachTagByName(leadId: string, name: string) {
  const r = await getOrCreateTag(name);
  if (!r.ok) return r;
  const a = await addTagToLead(leadId, r.tag.id);
  if (!a.ok) return a;
  return { ok: true as const, tag: r.tag };
}

export async function renameTag(tagId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false as const, error: 'Tag name is required' };
  const supabase = await createServerClient();
  const { error } = await supabase.from('tags').update({ name: trimmed }).eq('id', tagId);
  if (error) return { ok: false as const, error: error.message };
  bumpLead(null);
  return { ok: true as const };
}

export async function setTagColor(tagId: string, color: string) {
  const supabase = await createServerClient();
  const { error } = await supabase.from('tags').update({ color }).eq('id', tagId);
  if (error) return { ok: false as const, error: error.message };
  bumpLead(null);
  return { ok: true as const };
}

export async function deleteTag(tagId: string) {
  const supabase = await createServerClient();
  // Cascades to lead_tags via FK.
  const { error } = await supabase.from('tags').delete().eq('id', tagId);
  if (error) return { ok: false as const, error: error.message };
  bumpLead(null);
  return { ok: true as const };
}
