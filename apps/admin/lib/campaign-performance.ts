import 'server-only';

// Phase P: data layer for /campaigns/[id]/performance.
//
// Wraps `loadCallReport` with the campaign filter pre-applied, then
// layers on a tiny "live now" slice (in-progress calls scoped to this
// campaign + the campaign's roster joined to presence) so the page can
// show "who's working this campaign right now" without re-loading the
// whole live floor.

import { createServerClient } from '@leadpilot/db/server';
import { loadCallReport, type CallReport, type ReportFilter } from './reports';
import { loadActiveCalls, type ActiveCall } from './live-floor';
import { loadBrandPresence, type PresenceStatus } from './presence';

export type CampaignLiveAgent = {
  memberId: string;
  name: string;
  email: string;
  presence: PresenceStatus;
  currentCall: ActiveCall | null;
};

export type CampaignPerformance = {
  report: CallReport;
  liveAgents: CampaignLiveAgent[];
  activeCalls: ActiveCall[];
};

export async function loadCampaignPerformance(
  brandId: string,
  campaignId: string,
  filter: ReportFilter,
): Promise<CampaignPerformance> {
  const scoped: ReportFilter = { ...filter, campaignId };
  const supabase = await createServerClient();

  const [report, allActive, allPresence, agentsRes] = await Promise.all([
    loadCallReport(brandId, scoped),
    loadActiveCalls(brandId),
    loadBrandPresence(brandId),
    supabase
      .from('campaign_agents')
      .select('member_id, members!inner(id, full_name, email)')
      .eq('campaign_id', campaignId),
  ]);

  const presenceByMember = new Map(allPresence.map((p) => [p.memberId, p]));
  const activeForCampaign = allActive.filter((c) => c.campaignId === campaignId);
  const activeByMember = new Map<string, ActiveCall>();
  for (const c of activeForCampaign) {
    if (c.memberId) activeByMember.set(c.memberId, c);
  }

  const roster = (agentsRes.data ?? []).map((row) => {
    const member = row.members as { id: string; full_name: string | null; email: string } | null;
    return {
      memberId: row.member_id,
      fullName: member?.full_name ?? null,
      email: member?.email ?? '',
    };
  });

  const liveAgents: CampaignLiveAgent[] = roster
    .map((m): CampaignLiveAgent => {
      const p = presenceByMember.get(m.memberId);
      return {
        memberId: m.memberId,
        name: m.fullName?.trim() || m.email || 'Unknown agent',
        email: m.email,
        presence: p?.status ?? 'offline',
        currentCall: activeByMember.get(m.memberId) ?? null,
      };
    })
    .sort((a, b) => {
      // On-call first, then active, idle, offline. Same ordering used
      // on the Live Floor's agent grid so the muscle memory carries.
      const order: Record<PresenceStatus, number> = {
        on_call: 0,
        active: 1,
        idle: 2,
        offline: 3,
      };
      return order[a.presence] - order[b.presence];
    });

  return { report, liveAgents, activeCalls: activeForCampaign };
}
