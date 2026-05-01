'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import type { FieldMapping, PhoneCountry } from '@/lib/leads-import';

export async function saveImportPreset(input: {
  name: string;
  mapping: FieldMapping;
  defaultCountry: PhoneCountry;
  stageId: string | null;
  extraTagIds: string[];
  skipDedup: boolean;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: 'Name is required' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('import_presets')
    .insert({
      brand_id: active.id,
      name,
      // mapping is a flat Record<header,target>; FieldMapping satisfies
      // the JSONB shape, but TS can't see that without an explicit cast.
      mapping: input.mapping as unknown as never,
      default_country: input.defaultCountry,
      stage_id: input.stageId,
      extra_tag_ids: input.extraTagIds,
      skip_dedup: input.skipDedup,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) {
    const msg = error?.message ?? 'Insert failed';
    if (msg.includes('import_presets_brand_lower_name_uniq')) {
      return { ok: false as const, error: 'A preset with that name already exists.' };
    }
    return { ok: false as const, error: msg };
  }

  revalidatePath('/pipelines/import');
  return { ok: true as const, id: data.id };
}

export async function deleteImportPreset(input: { id: string }) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('import_presets')
    .delete()
    .eq('id', input.id)
    .eq('brand_id', active.id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/pipelines/import');
  return { ok: true as const };
}
