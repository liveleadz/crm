import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

// Smart-list saved filter criteria. Stored in lead_lists.criteria when
// source='filter'. Mirrors the URL search-param shape used by /leads.
export type SmartListCriteria = {
  search?: string | null;
  source?: string | null;
  tagIds?: string[] | null;
  excludeDnc?: boolean;
  excludeDne?: boolean;
};

export function parseCriteria(raw: unknown): SmartListCriteria | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: SmartListCriteria = {};
  if (typeof o.search === 'string') out.search = o.search;
  if (typeof o.source === 'string') out.source = o.source;
  if (Array.isArray(o.tagIds)) {
    out.tagIds = o.tagIds.filter((x): x is string => typeof x === 'string');
  }
  if (typeof o.excludeDnc === 'boolean') out.excludeDnc = o.excludeDnc;
  if (typeof o.excludeDne === 'boolean') out.excludeDne = o.excludeDne;
  return out;
}

export type LeadList = {
  id: string;
  name: string;
  source: 'import' | 'manual' | 'filter';
  // Only present (and only meaningful) for source='filter' lists.
  criteria: SmartListCriteria | null;
  createdAt: string;
  count: number;
};

export type CustomField = {
  id: string;
  key: string;
  label: string;
};

// Fetch all lists for a brand with their current lead counts (counted via
// leads.list_id). For source='filter' lists the count is dynamic — leads
// aren't materialized into a list_id — so we leave count=0 and the UI hides
// the badge.
export async function loadLists(brandId: string): Promise<LeadList[]> {
  const supabase = await createServerClient();
  const [listsRes, countsRes] = await Promise.all([
    supabase
      .from('lead_lists')
      .select('id, name, source, criteria, created_at')
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
    criteria: l.source === 'filter' ? parseCriteria(l.criteria) : null,
    createdAt: l.created_at,
    count: l.source === 'filter' ? 0 : counts.get(l.id) ?? 0,
  }));
}

// Subset of loadLists() returning only the lists attached to the given
// campaign. Used to slim the campaign editor's read-only view for
// agents — they shouldn't see the full brand list library, only the
// lists the campaign they're assigned to actually pulls from.
export async function loadCampaignLists(
  brandId: string,
  campaignId: string,
): Promise<LeadList[]> {
  const supabase = await createServerClient();
  const { data: cl } = await supabase
    .from('campaign_lists')
    .select('list_id')
    .eq('campaign_id', campaignId);
  const ids = Array.from(new Set((cl ?? []).map((r) => r.list_id)));
  if (ids.length === 0) return [];

  const [listsRes, countsRes] = await Promise.all([
    supabase
      .from('lead_lists')
      .select('id, name, source, criteria, created_at')
      .eq('brand_id', brandId)
      .in('id', ids)
      .order('created_at', { ascending: false }),
    supabase
      .from('leads')
      .select('list_id')
      .eq('brand_id', brandId)
      .in('list_id', ids),
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
    criteria: l.source === 'filter' ? parseCriteria(l.criteria) : null,
    createdAt: l.created_at,
    count: l.source === 'filter' ? 0 : counts.get(l.id) ?? 0,
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
