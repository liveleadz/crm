import 'server-only';
// Power dialer queue loader. Returns an ordered, deduped list of leads
// to dial through. Same brand-scoped filters that drive the Kanban /
// Leads list, plus power-dialer-specific guards:
//   - skip leads with no phone
//   - skip do_not_call=true
//   - skip leads called within the last `recentlyCalledMinutes` (so a
//     pause + resume doesn't immediately redial)

import { createServerClient } from '@leadpilot/db/server';

export type QueuedLead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  email: string | null;
  stageId: string | null;
};

export type QueueFilter = {
  listId?: string | null;
  search?: string | null;
  source?: string | null;
  tagIds?: string[] | null;
  // Skip leads that already had a logged call within this window. 0 disables.
  recentlyCalledMinutes?: number;
  // Hard cap so a click-to-dial doesn't queue 50k leads on a huge brand.
  limit?: number;
  // When set, ignore listId/search/source/tagIds and run the campaign queue:
  // union of leads in any campaign_lists row, with the campaign's
  // recentlyCalledMinutes default. Materialized lists only (import/manual);
  // smart filter lists in a campaign are silently skipped here.
  campaignId?: string | null;
};

export async function loadDialQueue(
  brandId: string,
  filter: QueueFilter = {},
): Promise<QueuedLead[]> {
  const supabase = await createServerClient();
  const limit = Math.max(1, Math.min(filter.limit ?? 500, 2000));

  // Campaign mode: load campaign lists + recentlyCalledMinutes; ignore the
  // ad-hoc filter inputs (listId/search/source/tagIds). If the campaign has
  // no materialized lists attached, return empty rather than dialing the
  // entire brand by accident.
  let campaignListIds: string[] | null = null;
  let effectiveRecentMin = filter.recentlyCalledMinutes ?? 0;
  if (filter.campaignId) {
    const [{ data: campaign }, { data: listLinks }] = await Promise.all([
      supabase
        .from('campaigns')
        .select('recently_called_minutes')
        .eq('id', filter.campaignId)
        .maybeSingle(),
      supabase
        .from('campaign_lists')
        .select('list_id, lead_lists!inner(source)')
        .eq('campaign_id', filter.campaignId),
    ]);
    if (filter.recentlyCalledMinutes === undefined && campaign) {
      effectiveRecentMin = campaign.recently_called_minutes ?? 240;
    }
    type LinkRow = { list_id: string; lead_lists: { source: string } | { source: string }[] | null };
    campaignListIds = ((listLinks as LinkRow[] | null) ?? [])
      .filter((r) => {
        const ll = Array.isArray(r.lead_lists) ? r.lead_lists[0] : r.lead_lists;
        return ll && ll.source !== 'filter';
      })
      .map((r) => r.list_id);
    if (campaignListIds.length === 0) return [];
  }

  // Base lead query — phone present, not DNC, not DNE-only mismatched.
  let query = supabase
    .from('leads')
    .select('id, first_name, last_name, phone, email, stage_id, source, do_not_call')
    .eq('brand_id', brandId)
    .eq('do_not_call', false)
    .not('phone', 'is', null);

  if (campaignListIds) {
    query = query.in('list_id', campaignListIds);
  }

  if (filter.search && !campaignListIds) {
    const q = filter.search.replace(/[%,]/g, ' ').trim();
    if (q) {
      query = query.or(
        [
          `first_name.ilike.%${q}%`,
          `last_name.ilike.%${q}%`,
          `phone.ilike.%${q}%`,
          `email.ilike.%${q}%`,
        ].join(','),
      );
    }
  }
  if (filter.source && !campaignListIds) {
    // The leads.source column is an enum; only certain values are valid.
    // Cast loosely so unknown filter strings simply yield no rows rather
    // than throw.
    query = query.eq('source', filter.source as 'manual' | 'form' | 'csv' | 'api' | 'workflow');
  }

  // List membership: leads have list_id directly (no join table).
  if (filter.listId && !campaignListIds) {
    query = query.eq('list_id', filter.listId);
  }

  // Tag filter: any-of semantics. tag_id IN (…) is small (the user's
  // selected tag count) so no chunking needed here.
  if (filter.tagIds && filter.tagIds.length > 0 && !campaignListIds) {
    const { data: tagRows } = await supabase
      .from('lead_tags')
      .select('lead_id')
      .in('tag_id', filter.tagIds);
    const tagLeadIds = Array.from(new Set((tagRows ?? []).map((r) => r.lead_id)));
    if (tagLeadIds.length === 0) return [];
    // Cap to avoid an ultra-long URL on the parent leads query.
    query = query.in('id', tagLeadIds.slice(0, 1000));
  }

  query = query.order('updated_at', { ascending: true }).limit(limit);

  const { data: leads } = await query;
  if (!leads || leads.length === 0) return [];

  // Optionally drop any lead with a recent call so we don't redial after
  // a pause. Default 0 (never skip). Campaign mode supplies its own default.
  const skipMin = effectiveRecentMin;
  let recentLeadIds = new Set<string>();
  if (skipMin > 0) {
    const since = new Date(Date.now() - skipMin * 60_000).toISOString();
    const { data: recent } = await supabase
      .from('calls')
      .select('lead_id')
      .eq('brand_id', brandId)
      .gte('started_at', since)
      .not('lead_id', 'is', null);
    recentLeadIds = new Set((recent ?? []).map((r) => r.lead_id as string));
  }

  return leads
    .filter((l) => l.phone && !recentLeadIds.has(l.id))
    .map<QueuedLead>((l) => ({
      id: l.id,
      firstName: l.first_name,
      lastName: l.last_name,
      phone: l.phone as string,
      email: l.email,
      stageId: l.stage_id,
    }));
}
