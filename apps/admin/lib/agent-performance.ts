import 'server-only';

// Phase Q: data layer for /team/[memberId].
//
// Wraps `loadCallReport` with the agent filter pre-applied, and pulls
// in three side panels: identity (member + role + presence), the
// campaigns this agent runs (with cheap per-campaign call totals over
// the same window), and a recent-calls list.
//
// Phase R: 7d / 30d on-screen totals are now backed by the
// `member_screen_daily` rollup table (today's live count is read from
// `member_presence.seconds_today` and added on top).

import { createServerClient } from '@leadpilot/db/server';
import { loadCallReport, type CallReport, type ReportFilter } from './reports';
import { loadCampaigns, type Campaign } from './campaigns';
import { loadBrandPresence, type PresenceStatus } from './presence';

export type AgentIdentity = {
  memberId: string;
  email: string;
  fullName: string | null;
  role: string;
  isActive: boolean;
  presence: PresenceStatus;
  secondsToday: number;
  seconds7d: number;
  seconds30d: number;
};

export type AgentRecentCall = {
  id: string;
  startedAt: string;
  direction: 'inbound' | 'outbound';
  durationSec: number | null;
  disposition: string | null;
  leadId: string | null;
  leadName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  recordingUrl: string | null;
};

export type AgentCampaignRow = {
  id: string;
  name: string;
  status: string;
  callsInRange: number;
};

export type AgentPerformance = {
  identity: AgentIdentity | null;
  report: CallReport;
  campaigns: AgentCampaignRow[];
  recentCalls: AgentRecentCall[];
};

export async function loadAgentPerformance(
  brandId: string,
  memberId: string,
  filter: ReportFilter,
): Promise<AgentPerformance> {
  const scoped: ReportFilter = { ...filter, agentId: memberId };
  const supabase = await createServerClient();

  // Local-day window for the screen-time rollup. We pull 30 days of
  // history (the longest window we render) and slice it into 7d/30d
  // sums client-side.
  const tz = filter.timezone || 'UTC';
  const todayLocal = localDayKey(new Date(), tz);
  const thirtyDaysAgoLocal = localDayKey(
    new Date(Date.now() - 29 * 24 * 60 * 60_000),
    tz,
  );
  const sevenDaysAgoLocal = localDayKey(
    new Date(Date.now() - 6 * 24 * 60 * 60_000),
    tz,
  );

  const [report, presence, identityRes, campaigns, recentRes, screenRes] = await Promise.all([
    loadCallReport(brandId, scoped),
    loadBrandPresence(brandId),
    supabase
      .from('brand_members')
      .select('role, is_active, members!inner(id, email, full_name)')
      .eq('brand_id', brandId)
      .eq('member_id', memberId)
      .maybeSingle(),
    loadCampaigns(brandId, { forMemberId: memberId, includeArchived: false }),
    supabase
      .from('calls')
      .select(
        'id, started_at, direction, duration_sec, disposition, lead_id, campaign_id, recording_url',
      )
      .eq('brand_id', brandId)
      .eq('member_id', memberId)
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('member_screen_daily')
      .select('day_local, seconds_on_screen')
      .eq('brand_id', brandId)
      .eq('member_id', memberId)
      .gte('day_local', thirtyDaysAgoLocal),
  ]);

  // Identity
  let identity: AgentIdentity | null = null;
  if (identityRes.data) {
    const member = identityRes.data.members as
      | { id: string; email: string; full_name: string | null }
      | null;
    const p = presence.find((row) => row.memberId === memberId);
    const secondsToday = p?.secondsToday ?? 0;

    // Today's seconds aren't in `member_screen_daily` yet (they're
    // still accumulating in `member_presence`), so add them on top.
    let seconds7d = secondsToday;
    let seconds30d = secondsToday;
    for (const r of screenRes.data ?? []) {
      if (r.day_local === todayLocal) continue; // safety: ignore if a snapshot already exists for today.
      if (r.day_local >= sevenDaysAgoLocal) seconds7d += r.seconds_on_screen ?? 0;
      seconds30d += r.seconds_on_screen ?? 0;
    }

    identity = {
      memberId,
      email: member?.email ?? '',
      fullName: member?.full_name ?? null,
      role: identityRes.data.role,
      isActive: identityRes.data.is_active,
      presence: p?.status ?? 'offline',
      secondsToday,
      seconds7d,
      seconds30d,
    };
  }

  // Per-campaign call totals over the *same window* the report uses.
  // We cheap-count from the calls already loaded in `report` rather
  // than firing another query — same source rows, just regrouped by
  // campaign_id. (loadCallReport doesn't expose campaign_id today, so
  // we issue one tight aggregate query here.)
  const campaignRows: AgentCampaignRow[] = await loadAgentCampaignTotals(
    brandId,
    memberId,
    report.fromIso,
    report.toIso,
    campaigns,
  );

  // Recent calls — join lead + campaign labels for the table.
  const recent = recentRes.data ?? [];
  const leadIds = Array.from(
    new Set(recent.map((r) => r.lead_id).filter((x): x is string => !!x)),
  );
  const campaignIdsSet = Array.from(
    new Set(recent.map((r) => r.campaign_id).filter((x): x is string => !!x)),
  );
  const [leadsRes, campaignsRes] = await Promise.all([
    leadIds.length > 0
      ? supabase.from('leads').select('id, first_name, last_name').in('id', leadIds)
      : Promise.resolve({
          data: [] as Array<{ id: string; first_name: string | null; last_name: string | null }>,
        }),
    campaignIdsSet.length > 0
      ? supabase.from('campaigns').select('id, name').in('id', campaignIdsSet)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const leadById = new Map((leadsRes.data ?? []).map((l) => [l.id, l]));
  const campaignById = new Map((campaignsRes.data ?? []).map((c) => [c.id, c]));

  const recentCalls: AgentRecentCall[] = recent.map((r) => {
    const lead = r.lead_id ? leadById.get(r.lead_id) : undefined;
    const campaign = r.campaign_id ? campaignById.get(r.campaign_id) : undefined;
    const leadName = lead
      ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
      : null;
    return {
      id: r.id,
      startedAt: r.started_at,
      direction: r.direction as 'inbound' | 'outbound',
      durationSec: r.duration_sec,
      disposition: r.disposition,
      leadId: r.lead_id,
      leadName,
      campaignId: r.campaign_id,
      campaignName: campaign?.name ?? null,
      recordingUrl: r.recording_url,
    };
  });

  return { identity, report, campaigns: campaignRows, recentCalls };
}

async function loadAgentCampaignTotals(
  brandId: string,
  memberId: string,
  fromIso: string,
  toIso: string,
  campaigns: Campaign[],
): Promise<AgentCampaignRow[]> {
  if (campaigns.length === 0) return [];
  const supabase = await createServerClient();
  const ids = campaigns.map((c) => c.id);
  const { data } = await supabase
    .from('calls')
    .select('campaign_id')
    .eq('brand_id', brandId)
    .eq('member_id', memberId)
    .in('campaign_id', ids)
    .gte('started_at', fromIso)
    .lte('started_at', toIso)
    .limit(50_000);
  const totalByCampaign = new Map<string, number>();
  for (const r of data ?? []) {
    if (!r.campaign_id) continue;
    totalByCampaign.set(r.campaign_id, (totalByCampaign.get(r.campaign_id) ?? 0) + 1);
  }
  return campaigns
    .map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      callsInRange: totalByCampaign.get(c.id) ?? 0,
    }))
    .sort((a, b) => b.callsInRange - a.callsInRange);
}

// YYYY-MM-DD in the brand's local timezone — same shape stored in
// `member_screen_daily.day_local`. Inlined to avoid pulling 'server-only'
// helpers transitively.
function localDayKey(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}
