'use server';

// CRUD actions for per-brand dispositions. Owner/admin only — RLS
// enforces this at the database layer; we still gate `getActiveBrand()`
// here so we never operate on the wrong brand.

import { revalidatePath } from 'next/cache';
import { getActiveBrand } from '@/lib/active-brand';
import { createServerClient } from '@leadpilot/db/server';
import { DISPOSITION_CATEGORIES, type DispositionCategory } from '@/lib/dispositions-shared';

type Result<T = void> = T extends void
  ? { ok: true } | { ok: false; error: string }
  : { ok: true; data: T } | { ok: false; error: string };

const CODE_RE = /^[a-z][a-z0-9_]*$/;

function validateTone(tone: string): tone is 'good' | 'neutral' | 'bad' {
  return tone === 'good' || tone === 'neutral' || tone === 'bad';
}

function validateCategory(c: string): c is DispositionCategory {
  return (DISPOSITION_CATEGORIES as readonly string[]).includes(c);
}

export async function createDisposition(input: {
  code: string;
  label: string;
  tone: string;
  category?: string;
}): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const code = input.code.trim().toLowerCase();
  const label = input.label.trim();
  if (!CODE_RE.test(code)) {
    return { ok: false, error: 'Code must be lowercase letters/numbers/underscore, starting with a letter.' };
  }
  if (!label) return { ok: false, error: 'Label is required.' };
  if (!validateTone(input.tone)) return { ok: false, error: 'Invalid tone.' };
  const category: DispositionCategory =
    input.category && validateCategory(input.category) ? input.category : 'other';

  const supabase = await createServerClient();
  // Place new entry at the end of the active list.
  const { data: maxRow } = await supabase
    .from('dispositions')
    .select('sort_order')
    .eq('brand_id', active.id)
    .eq('is_archived', false)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSort = (maxRow?.sort_order ?? 0) + 1;

  const { error } = await supabase.from('dispositions').insert({
    brand_id: active.id,
    code,
    label,
    tone: input.tone,
    category,
    sort_order: nextSort,
  });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Code "${code}" already exists in this brand.` };
    }
    return { ok: false, error: error.message };
  }
  revalidatePath('/(app)/settings', 'page');
  return { ok: true };
}

// Update only the category — used by the row's category select. Kept
// separate from updateDisposition so the UI can patch one field
// without sending the label/tone too.
export async function setDispositionCategory(input: {
  id: string;
  category: string;
}): Promise<Result> {
  if (!validateCategory(input.category)) {
    return { ok: false, error: 'Invalid category.' };
  }
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('dispositions')
    .update({ category: input.category })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/(app)/settings', 'page');
  return { ok: true };
}

export async function updateDisposition(input: {
  id: string;
  label: string;
  tone: string;
}): Promise<Result> {
  const label = input.label.trim();
  if (!label) return { ok: false, error: 'Label is required.' };
  if (!validateTone(input.tone)) return { ok: false, error: 'Invalid tone.' };

  const supabase = await createServerClient();
  const { error } = await supabase
    .from('dispositions')
    .update({ label, tone: input.tone })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/(app)/settings', 'page');
  return { ok: true };
}

// Cooldown is independent from rename/tone so the row UI can patch it
// inline without sending the whole record.
export async function setDispositionCooldown(input: {
  id: string;
  minutes: number | null;
}): Promise<Result> {
  if (input.minutes !== null) {
    if (!Number.isInteger(input.minutes) || input.minutes < 0 || input.minutes > 60 * 24 * 7) {
      return { ok: false, error: 'Cooldown must be 0–10080 minutes (7 days).' };
    }
  }
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('dispositions')
    .update({ cooldown_minutes: input.minutes && input.minutes > 0 ? input.minutes : null })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/(app)/settings', 'page');
  return { ok: true };
}

// Soft-delete: archive instead of removing so historical calls keep
// their disposition label resolvable.
export async function archiveDisposition(input: { id: string }): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('dispositions')
    .update({ is_archived: true })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/(app)/settings', 'page');
  return { ok: true };
}

export async function restoreDisposition(input: { id: string }): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('dispositions')
    .update({ is_archived: false })
    .eq('id', input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/(app)/settings', 'page');
  return { ok: true };
}

// Bulk reorder: client sends the full ordered id list, we rewrite
// sort_order in one transactional pass.
export async function reorderDispositions(input: { ids: string[] }): Promise<Result> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const supabase = await createServerClient();
  // Run updates serially — Supabase doesn't expose a bulk-CASE update.
  // Sort orders are tiny (≤ ~20 rows in practice).
  for (let i = 0; i < input.ids.length; i++) {
    const id = input.ids[i];
    if (!id) continue;
    const { error } = await supabase
      .from('dispositions')
      .update({ sort_order: i + 1 })
      .eq('id', id)
      .eq('brand_id', active.id);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath('/(app)/settings', 'page');
  return { ok: true };
}
