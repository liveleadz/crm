import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type Tag = {
  id: string;
  name: string;
  color: string;
};

export async function loadBrandTags(brandId: string): Promise<Tag[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('tags')
    .select('id, name, color')
    .eq('brand_id', brandId)
    .order('name', { ascending: true });
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color ?? 'slate',
  }));
}

// Resolve which tags are attached to each lead. Returned map is keyed by leadId.
export async function loadTagsForLeads(
  leadIds: string[],
): Promise<Map<string, Tag[]>> {
  const map = new Map<string, Tag[]>();
  if (leadIds.length === 0) return map;
  const supabase = await createServerClient();
  // Chunk the IN list. Supabase serializes filters into the request URL,
  // so a single 5000-id query exceeds the URL length limit and the
  // request fails (manifests as a server-side exception on the calling
  // page). 500 ids per chunk keeps each URL well under the 8KB cap.
  const CHUNK = 500;
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const slice = leadIds.slice(i, i + CHUNK);
    const { data } = await supabase
      .from('lead_tags')
      .select('lead_id, tags:tag_id ( id, name, color )')
      .in('lead_id', slice);
    for (const row of data ?? []) {
      const t = row.tags as { id: string; name: string; color: string | null } | null;
      if (!t) continue;
      const list = map.get(row.lead_id) ?? [];
      list.push({ id: t.id, name: t.name, color: t.color ?? 'slate' });
      map.set(row.lead_id, list);
    }
  }
  return map;
}

export async function loadLeadTags(leadId: string): Promise<Tag[]> {
  const m = await loadTagsForLeads([leadId]);
  return m.get(leadId) ?? [];
}

// Settings page: tag list with per-tag attached lead counts.
export type TagWithCount = Tag & { leadCount: number };

export async function loadBrandTagsWithCounts(brandId: string): Promise<TagWithCount[]> {
  const supabase = await createServerClient();
  const tagsRes = await supabase
    .from('tags')
    .select('id, name, color')
    .eq('brand_id', brandId)
    .order('name', { ascending: true });
  const tags = tagsRes.data ?? [];
  if (tags.length === 0) return [];
  const ids = tags.map((t) => t.id);
  const { data: links } = await supabase
    .from('lead_tags')
    .select('tag_id')
    .in('tag_id', ids);
  const counts = new Map<string, number>();
  for (const l of links ?? []) {
    counts.set(l.tag_id, (counts.get(l.tag_id) ?? 0) + 1);
  }
  return tags.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color ?? 'slate',
    leadCount: counts.get(t.id) ?? 0,
  }));
}
