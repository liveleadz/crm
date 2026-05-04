import 'server-only';
// Power dialer queue loader. Returns an ordered, deduped list of leads
// to dial through. Same brand-scoped filters that drive the Kanban /
// Leads list, plus power-dialer-specific guards:
//   - skip leads with no phone
//   - skip do_not_call=true
//   - skip leads called within the last `recentlyCalledMinutes` (so a
//     pause + resume doesn't immediately redial)

import { createServerClient } from '@leadpilot/db/server';
import { dialWindowCheck } from './tcpa';
import { pickCompanyFromCustom } from './company-name';

export type QueuedLead = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
  email: string | null;
  stageId: string | null;
  // Pulled from leads.custom JSONB. We try a few common keys so imports
  // that used "Company" / "company_name" / etc. all surface in the dialer.
  companyName: string | null;
  city: string | null;
  state: string | null;
};

export type QueueFilter = {
  listId?: string | null;
  search?: string | null;
  source?: string | null;
  tagIds?: string[] | null;
  // Optional pipeline stage filter — used by the "Power dial this stage"
  // entry point on the kanban.
  stageId?: string | null;
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
  let tcpaPolicy: {
    enabled: boolean;
    startMin: number;
    endMin: number;
    skipWeekends: boolean;
  } | null = null;
  let brandTimezone = 'UTC';
  if (filter.campaignId) {
    const [{ data: campaign }, { data: listLinks }] = await Promise.all([
      supabase
        .from('campaigns')
        .select(
          'recently_called_minutes, tcpa_enabled, dial_window_start_min, dial_window_end_min, skip_weekends, brand_id, brands!inner(timezone)',
        )
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
    if (campaign) {
      const brandJoin = (
        Array.isArray(campaign.brands) ? campaign.brands[0] : campaign.brands
      ) as { timezone: string } | null;
      brandTimezone = brandJoin?.timezone ?? 'UTC';
      tcpaPolicy = {
        enabled: campaign.tcpa_enabled,
        startMin: campaign.dial_window_start_min,
        endMin: campaign.dial_window_end_min,
        skipWeekends: campaign.skip_weekends,
      };
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
    .select('id, first_name, last_name, phone, email, stage_id, source, do_not_call, custom, city, state')
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

  // Stage filter: dial everyone in a single pipeline stage. Stacks with
  // ad-hoc filters (search/source/tags); ignored in campaign mode.
  if (filter.stageId && !campaignListIds) {
    query = query.eq('stage_id', filter.stageId);
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

  // Brand-wide attempt cap + per-disposition cooldown. Both filters look
  // back 24h of calls (the max useful window for either guardrail) in a
  // single query, then bucket lead_ids in JS. NULL/0 cap = disabled.
  const cappedLeadIds = new Set<string>();
  const cooldownLeadIds = new Set<string>();
  const { data: brandCfg } = await supabase
    .from('brands')
    .select('max_dials_per_lead_per_day')
    .eq('id', brandId)
    .maybeSingle();
  const dailyCap = brandCfg?.max_dials_per_lead_per_day ?? null;

  // calls.disposition stores the code (text), not the FK id, so we map
  // cooldowns by code here.
  const { data: dispRows } = await supabase
    .from('dispositions')
    .select('code, cooldown_minutes')
    .eq('brand_id', brandId);
  const cooldownByCode = new Map<string, number>();
  for (const d of dispRows ?? []) {
    if (d.cooldown_minutes && d.cooldown_minutes > 0) {
      cooldownByCode.set(d.code, d.cooldown_minutes);
    }
  }

  if (dailyCap || cooldownByCode.size > 0) {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const { data: dayCalls } = await supabase
      .from('calls')
      .select('lead_id, started_at, disposition')
      .eq('brand_id', brandId)
      .gte('started_at', dayAgo)
      .not('lead_id', 'is', null);

    const counts = new Map<string, number>();
    const now = Date.now();
    for (const c of dayCalls ?? []) {
      const lid = c.lead_id as string;
      if (dailyCap) counts.set(lid, (counts.get(lid) ?? 0) + 1);
      const cdMin = c.disposition ? cooldownByCode.get(c.disposition) : undefined;
      if (cdMin) {
        const startedMs = new Date(c.started_at).getTime();
        if (now - startedMs < cdMin * 60_000) cooldownLeadIds.add(lid);
      }
    }
    if (dailyCap) {
      for (const [lid, n] of counts) {
        if (n >= dailyCap) cappedLeadIds.add(lid);
      }
    }
  }

  // TCPA soft block. Only filters when the campaign opted in; otherwise
  // pass-through. Lead state drives timezone with brand-tz fallback.
  const tcpaFilter = (state: string | null) => {
    if (!tcpaPolicy || !tcpaPolicy.enabled) return true;
    return dialWindowCheck({
      leadState: state,
      brandTimezone,
      policy: tcpaPolicy,
    }).ok;
  };

  return leads
    .filter(
      (l) =>
        l.phone &&
        !recentLeadIds.has(l.id) &&
        !cappedLeadIds.has(l.id) &&
        !cooldownLeadIds.has(l.id) &&
        tcpaFilter(l.state),
    )
    .map<QueuedLead>((l) => ({
      id: l.id,
      firstName: l.first_name,
      lastName: l.last_name,
      phone: l.phone as string,
      email: l.email,
      stageId: l.stage_id,
      companyName: pickCompanyFromCustom(l.custom),
      city: l.city,
      state: l.state,
    }));
}
