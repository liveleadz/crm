import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type DispositionTone = 'good' | 'neutral' | 'bad';

// Fixed-vocabulary metric category. The brand's `code` and `label` are
// brand-configurable, so reports cannot read them directly — a brand
// could rename "Connected" to "Closed" and the connect rate would
// silently drop to zero. `category` is the stable axis the reports
// layer aggregates against.
export type DispositionCategory =
  | 'wrong_number'
  | 'no_answer'
  | 'voicemail'
  | 'connected'
  | 'appointment_set'
  | 'callback'
  | 'do_not_call'
  | 'not_interested'
  | 'other';

export const DISPOSITION_CATEGORIES: DispositionCategory[] = [
  'connected',
  'appointment_set',
  'callback',
  'voicemail',
  'no_answer',
  'wrong_number',
  'not_interested',
  'do_not_call',
  'other',
];

export const DISPOSITION_CATEGORY_LABELS: Record<DispositionCategory, string> = {
  connected: 'Connected',
  appointment_set: 'Appointment set',
  callback: 'Callback',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
  do_not_call: 'Do not call',
  other: 'Other',
};

// Categories that count as a "connect" for the connect-rate KPI.
export const CONNECTED_CATEGORIES: ReadonlySet<DispositionCategory> = new Set<DispositionCategory>([
  'connected',
  'appointment_set',
  'callback',
  'not_interested',
]);

export type Disposition = {
  id: string;
  code: string;
  label: string;
  tone: DispositionTone;
  category: DispositionCategory;
  sortOrder: number;
  // After a call resolves with this disposition, suppress this lead from
  // queue / manual dial for N minutes. NULL/0 = no cooldown.
  cooldownMinutes: number | null;
};

function normalizeCategory(raw: unknown): DispositionCategory {
  if (typeof raw !== 'string') return 'other';
  return (DISPOSITION_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as DispositionCategory)
    : 'other';
}

// Active (non-archived) dispositions for a brand, in display order.
export async function loadDispositions(brandId: string): Promise<Disposition[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('dispositions')
    .select('id, code, label, tone, category, sort_order, cooldown_minutes')
    .eq('brand_id', brandId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true });
  if (!data) return [];
  return data.map((d) => ({
    id: d.id,
    code: d.code,
    label: d.label,
    tone: (d.tone as DispositionTone) ?? 'neutral',
    category: normalizeCategory(d.category),
    sortOrder: d.sort_order,
    cooldownMinutes: d.cooldown_minutes ?? null,
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
    map.set(r.code, normalizeCategory(r.category));
  }
  return (code) => (code ? map.get(code) ?? 'other' : 'other');
}
