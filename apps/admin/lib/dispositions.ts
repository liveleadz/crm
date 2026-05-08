import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import {
  normalizeDispositionCategory,
  type Disposition,
  type DispositionCategory,
  type DispositionTone,
} from './dispositions-shared';

// Re-export the shared surface so existing imports of '@/lib/dispositions'
// keep working. Client components should import from
// '@/lib/dispositions-shared' directly to avoid pulling in this
// server-only module.
export {
  DISPOSITION_CATEGORIES,
  DISPOSITION_CATEGORY_LABELS,
  CONNECTED_CATEGORIES,
} from './dispositions-shared';
export type {
  Disposition,
  DispositionCategory,
  DispositionTone,
} from './dispositions-shared';

// Active (non-archived) dispositions for a brand, in display order.
export async function loadDispositions(brandId: string): Promise<Disposition[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('dispositions')
    .select(
      'id,code,label,tone,category,sort_order,cooldown_minutes,escalation_enabled,escalation_stage_ids,escalation_terminal_stage_id,escalation_terminal_tag_id,escalation_terminal_set_dnc,escalation_match_category',
    )
    .eq('brand_id', brandId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true });
  if (!data) return [];
  return data.map((d) => ({
    id: d.id,
    code: d.code,
    label: d.label,
    tone: (d.tone as DispositionTone) ?? 'neutral',
    category: normalizeDispositionCategory(d.category),
    sortOrder: d.sort_order,
    cooldownMinutes: d.cooldown_minutes ?? null,
    escalation: {
      enabled: d.escalation_enabled ?? false,
      stageIds: d.escalation_stage_ids ?? [],
      terminalStageId: d.escalation_terminal_stage_id ?? null,
      terminalTagId: d.escalation_terminal_tag_id ?? null,
      terminalSetDnc: d.escalation_terminal_set_dnc ?? false,
      matchCategory: d.escalation_match_category ?? true,
    },
  }));
}

// Build a code → category lookup for a brand. Codes that don't resolve
// (e.g. a legacy call written before a disposition was archived) are
// reported as 'other' by the lookup function.
export async function loadCategoryByCode(
  brandId: string,
): Promise<(code: string | null | undefined) => DispositionCategory> {
  const supabase = await createServerClient();
  // Include archived rows — historical calls may reference them.
  const { data } = await supabase
    .from('dispositions')
    .select('code, category')
    .eq('brand_id', brandId);
  const map = new Map<string, DispositionCategory>();
  for (const r of data ?? []) {
    map.set(r.code, normalizeDispositionCategory(r.category));
  }
  return (code) => (code ? map.get(code) ?? 'other' : 'other');
}
