'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { requireBrandRole } from '@/lib/team';

const COLORS = ['teal', 'hp', 'vl', 'bs', 'll', 'hb', 'bi'] as const;
type StageColor = (typeof COLORS)[number];

function isColor(v: unknown): v is StageColor {
  return typeof v === 'string' && (COLORS as readonly string[]).includes(v);
}

function bumpAll() {
  revalidatePath('/leads');
  revalidatePath('/settings');
  revalidatePath('/dashboard');
}

export async function createStage(input: {
  name: string;
  color?: string | null;
  isWon?: boolean;
  isLost?: boolean;
}) {
  const guard = await requireBrandRole('manager');
  if (!guard.ok) return guard;
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: 'Name is required' };
  const supabase = await createServerClient();
  const { data: existing } = await supabase
    .from('stages')
    .select('position')
    .eq('brand_id', guard.brandId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPos = (existing?.position ?? -1) + 1;
  const color = isColor(input.color) ? input.color : null;
  const { data, error } = await supabase
    .from('stages')
    .insert({
      brand_id: guard.brandId,
      name,
      color,
      position: nextPos,
      is_won: !!input.isWon,
      is_lost: !!input.isLost,
    })
    .select('id, name, color, position, is_won, is_lost, is_appointment_set, is_no_show')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed' };
  bumpAll();
  return {
    ok: true as const,
    stage: {
      id: data.id,
      name: data.name,
      color: data.color,
      position: data.position,
      isWon: data.is_won,
      isLost: data.is_lost,
      isAppointmentSet: data.is_appointment_set,
      isNoShow: data.is_no_show,
    },
  };
}

export async function updateStage(
  stageId: string,
  patch: { name?: string; color?: string | null; isWon?: boolean; isLost?: boolean },
) {
  const guard = await requireBrandRole('manager');
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  const update: {
    name?: string;
    color?: string | null;
    is_won?: boolean;
    is_lost?: boolean;
  } = {};
  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) return { ok: false as const, error: 'Name cannot be empty' };
    update.name = trimmed;
  }
  if (patch.color !== undefined) {
    update.color = patch.color === null ? null : isColor(patch.color) ? patch.color : null;
  }
  if (patch.isWon !== undefined) update.is_won = patch.isWon;
  if (patch.isLost !== undefined) update.is_lost = patch.isLost;
  const { error } = await supabase
    .from('stages')
    .update(update)
    .eq('id', stageId)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false as const, error: error.message };
  bumpAll();
  return { ok: true as const };
}

export async function deleteStage(stageId: string) {
  const guard = await requireBrandRole('manager');
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  // Block delete if any leads still reference the stage.
  const { count } = await supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('stage_id', stageId);
  if ((count ?? 0) > 0) {
    return {
      ok: false as const,
      error: `Cannot delete: ${count} lead${count === 1 ? '' : 's'} still in this stage.`,
    };
  }
  const { error } = await supabase
    .from('stages')
    .delete()
    .eq('id', stageId)
    .eq('brand_id', guard.brandId);
  if (error) return { ok: false as const, error: error.message };
  bumpAll();
  return { ok: true as const };
}

export async function reorderStages(orderedIds: string[]) {
  const guard = await requireBrandRole('manager');
  if (!guard.ok) return guard;
  const supabase = await createServerClient();
  // Two-phase: shift to negative positions to dodge the (brand_id, position) unique
  // constraint, then write final positions.
  for (let i = 0; i < orderedIds.length; i += 1) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from('stages')
      .update({ position: -(i + 1) })
      .eq('id', id)
      .eq('brand_id', guard.brandId);
    if (error) return { ok: false as const, error: error.message };
  }
  for (let i = 0; i < orderedIds.length; i += 1) {
    const id = orderedIds[i]!;
    const { error } = await supabase
      .from('stages')
      .update({ position: i })
      .eq('id', id)
      .eq('brand_id', guard.brandId);
    if (error) return { ok: false as const, error: error.message };
  }
  bumpAll();
  return { ok: true as const };
}
