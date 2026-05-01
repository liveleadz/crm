import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import type { FieldMapping, PhoneCountry } from './leads-import';

export type ImportPreset = {
  id: string;
  name: string;
  mapping: FieldMapping;
  defaultCountry: PhoneCountry;
  stageId: string | null;
  extraTagIds: string[];
  skipDedup: boolean;
  createdAt: string;
};

export async function loadImportPresets(brandId: string): Promise<ImportPreset[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('import_presets')
    .select(
      'id, name, mapping, default_country, stage_id, extra_tag_ids, skip_dedup, created_at',
    )
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    // mapping is jsonb — cast through unknown so we don't pull the full
    // FieldMapping invariants into the runtime check. The wizard
    // tolerates unknown header keys (they're ignored at apply time).
    mapping: (p.mapping ?? {}) as unknown as FieldMapping,
    defaultCountry: (p.default_country as PhoneCountry) ?? 'US',
    stageId: p.stage_id,
    extraTagIds: p.extra_tag_ids ?? [],
    skipDedup: p.skip_dedup,
    createdAt: p.created_at,
  }));
}
