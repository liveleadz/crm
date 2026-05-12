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

// Fetch all lists for a brand with their current lead counts.
//
// Previously this used a single `.select('list_id')` over leads and
// counted in JS, but PostgREST silently truncates `.select()` at the
// project's max-rows setting (default 1000). On any brand with more
// than 1000 listed leads the pill counts undercounted — e.g.,
// 266 + 734 = 1000 exactly, even though the true totals were 1142 and
// 734 for a brand of 1876 leads. Each list now gets its own
// `count: 'exact', head: true` query, which returns the real row
// count via the Content-Range header without fetching data and
// without hitting the row cap.
export async function loadLists(brandId: string): Promise<LeadList[]> {
  const supabase = await createServerClient();
  const { data: listsRaw } = await supabase
    .from('lead_lists')
    .select('id, name, source, criteria, created_at')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  const lists = listsRaw ?? [];
  if (lists.length === 0) return [];

  // Per-list count queries fired in parallel. For materialized lists
  // (import / manual) we count rows with list_id = this.id. For smart
  // filter lists we count rows that match the saved criteria — the
  // same subset the kanban / leads table will render when the pill is
  // clicked. Tag filtering requires a lead_tags join, so we apply it
  // via a pre-resolved id set when present.
  const countPromises = lists.map(async (l) => {
    if (l.source === 'filter') {
      const c = parseCriteria(l.criteria);
      let q = supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId);
      if (c?.source) {
        q = q.eq(
          'source',
          c.source as 'manual' | 'form' | 'csv' | 'api' | 'workflow',
        );
      }
      if (c?.excludeDnc) q = q.eq('do_not_call', false);
      if (c?.excludeDne) q = q.eq('do_not_email', false);
      if (c?.search) {
        const esc = c.search.replace(/[%,]/g, ' ').trim();
        if (esc) {
          const pattern = `%${esc}%`;
          q = q.or(
            `first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`,
          );
        }
      }
      if (c?.tagIds && c.tagIds.length > 0) {
        const { data: tagRows } = await supabase
          .from('lead_tags')
          .select('lead_id')
          .in('tag_id', c.tagIds);
        const tagLeadIds = Array.from(
          new Set((tagRows ?? []).map((r) => r.lead_id)),
        );
        if (tagLeadIds.length === 0) return [l.id, 0] as const;
        q = q.in('id', tagLeadIds);
      }
      const { count } = await q;
      return [l.id, count ?? 0] as const;
    }
    const { count } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('list_id', l.id);
    return [l.id, count ?? 0] as const;
  });

  const counts = new Map(await Promise.all(countPromises));

  return lists.map((l) => ({
    id: l.id,
    name: l.name,
    source: l.source,
    criteria: l.source === 'filter' ? parseCriteria(l.criteria) : null,
    createdAt: l.created_at,
    count: counts.get(l.id) ?? 0,
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

  const { data: listsRaw } = await supabase
    .from('lead_lists')
    .select('id, name, source, criteria, created_at')
    .eq('brand_id', brandId)
    .in('id', ids)
    .order('created_at', { ascending: false });

  const lists = listsRaw ?? [];
  if (lists.length === 0) return [];

  // Same pattern as loadLists: per-list head-count to avoid the
  // PostgREST 1000-row cap when summing list_id memberships in JS.
  const countPromises = lists.map(async (l) => {
    const { count } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('list_id', l.id);
    return [l.id, count ?? 0] as const;
  });

  const counts = new Map(await Promise.all(countPromises));

  return lists.map((l) => ({
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
