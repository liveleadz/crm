import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type DispositionTone = 'good' | 'neutral' | 'bad';

export type Disposition = {
  id: string;
  code: string;
  label: string;
  tone: DispositionTone;
  sortOrder: number;
  // After a call resolves with this disposition, suppress this lead from
  // queue / manual dial for N minutes. NULL/0 = no cooldown.
  cooldownMinutes: number | null;
};

// Active (non-archived) dispositions for a brand, in display order.
export async function loadDispositions(brandId: string): Promise<Disposition[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('dispositions')
    .select('id, code, label, tone, sort_order, cooldown_minutes')
    .eq('brand_id', brandId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true });
  if (!data) return [];
  return data.map((d) => ({
    id: d.id,
    code: d.code,
    label: d.label,
    tone: (d.tone as DispositionTone) ?? 'neutral',
    sortOrder: d.sort_order,
    cooldownMinutes: d.cooldown_minutes ?? null,
  }));
}
