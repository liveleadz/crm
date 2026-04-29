import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type LeadList = {
  id: string;
  name: string;
  source: 'import' | 'manual' | 'filter';
  createdAt: string;
  count: number;
};

export type CustomField = {
  id: string;
  key: string;
  label: string;
};

// Fetch all lists for a brand with their current lead counts (counted via leads.list_id).
export async function loadLists(brandId: string): Promise<LeadList[]> {
  const supabase = await createServerClient();
  const [listsRes, countsRes] = await Promise.all([
    supabase
      .from('lead_lists')
      .select('id, name, source, created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false }),
    supabase
      .from('leads')
      .select('list_id')
      .eq('brand_id', brandId)
      .not('list_id', 'is', null),
  ]);

  const counts = new Map<string, number>();
  for (const row of countsRes.data ?? []) {
    if (!row.list_id) continue;
    counts.set(row.list_id, (counts.get(row.list_id) ?? 0) + 1);
  }

  return (listsRes.data ?? []).map((l) => ({
    id: l.id,
    name: l.name,
    source: l.source,
    createdAt: l.created_at,
    count: counts.get(l.id) ?? 0,
  }));
}

export async function loadCustomFields(brandId: string): Promise<CustomField[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('lead_custom_fields')
    .select('id, key, label')
    .eq('brand_id', brandId)
    .order('label');
  return (data ?? []).map((f) => ({ id: f.id, key: f.key, label: f.label }));
}

// Slug a free-form label into a stable JSONB key. Lowercase, alnum + underscore.
export function slugifyLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}
