import 'server-only';

// Manager alerts panel — read-only anomaly detection over the same
// window the leaderboard uses. Flagged conditions are deliberately
// noisy-on-purpose (the manager looks at this when something feels off,
// not as a daily report). Each alert includes a short label + a count
// or sample so the manager can act without opening a sub-page.
//
// Alert kinds:
//   - underperforming_rep: rep with conversion < 50% of team avg
//     among reps with ≥ MIN_CALLS in window.
//   - voicemail_backlog:   inbound calls with handled_at IS NULL older
//     than 24h. (Lives forever in `calls` if not handled.)
//   - paused_with_activity: a paused campaign still receiving calls in
//     the last 7d — usually a forgotten pause or an off-target script.
//   - list_exhausted: materialized list where ≥ 90% of leads are
//     unreachable (do_not_call OR called in last 7d) and total > 50.

import { createServerClient } from '@leadpilot/db/server';
import { rollingRangeBounds, type RollingRange } from './datetime';

const MIN_CALLS_FOR_REP_FLAG = 20;
const REP_UNDERPERFORM_FACTOR = 0.5;
const VM_BACKLOG_HOURS = 24;
const LIST_EXHAUSTED_THRESHOLD = 0.9;
const LIST_MIN_TOTAL = 50;

export type TeamAlert =
  | {
      kind: 'underperforming_rep';
      memberId: string;
      name: string;
      calls: number;
      conversionRate: number;
      teamConversionRate: number;
    }
  | {
      kind: 'voicemail_backlog';
      count: number;
      oldestHours: number;
    }
  | {
      kind: 'paused_with_activity';
      campaignId: string;
      name: string;
      callsLast7d: number;
    }
  | {
      kind: 'list_exhausted';
      listId: string;
      name: string;
      totalLeads: number;
      unreachablePct: number;
    }
  | {
      // Phase S — open SLA violations from /api/cron/sla-tick.
      kind: 'agent_idle';
      memberId: string;
      name: string;
      minutes: number;
    }
  | {
      kind: 'no_calls_active';
      memberId: string;
      name: string;
      minutes: number;
    };

export type TeamAlerts = {
  fromIso: string;
  toIso: string;
  alerts: TeamAlert[];
};

export async function loadTeamAlerts(
  brandId: string,
  brandTimezone: string,
  filter: { range: RollingRange; fromIso?: string | null; toIso?: string | null },
): Promise<TeamAlerts> {
  const supabase = await createServerClient();
  const { fromIso, toIso } = rollingRangeBounds(filter.range, brandTimezone, {
    fromIso: filter.fromIso ?? null,
    toIso: filter.toIso ?? null,
  });

  const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const vmThresholdIso = new Date(Date.now() - VM_BACKLOG_HOURS * 60 * 60_000).toISOString();

  const [callsRes, apptsRes, membersRes, vmRes, pausedCampRes, listsRes, slaRes] =
    await Promise.all([
      supabase
        .from('calls')
        .select('member_id')
        .eq('brand_id', brandId)
        .gte('started_at', fromIso)
        .lte('started_at', toIso)
        .limit(50_000),
      supabase
        .from('appointments')
        .select('member_id')
        .eq('brand_id', brandId)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .limit(10_000),
      supabase
        .from('brand_members')
        .select('members!inner(id, full_name, email)')
        .eq('brand_id', brandId)
        .eq('is_active', true),
      supabase
        .from('calls')
        .select('id, started_at')
        .eq('brand_id', brandId)
        .eq('direction', 'inbound')
        .is('handled_at', null)
        .lte('started_at', vmThresholdIso)
        .order('started_at', { ascending: true }),
      supabase
        .from('campaigns')
        .select('id, name, status')
        .eq('brand_id', brandId)
        .eq('status', 'paused'),
      supabase
        .from('lead_lists')
        .select('id, name, source')
        .eq('brand_id', brandId),
      supabase
        .from('sla_violations')
        .select('member_id, kind, detail')
        .eq('brand_id', brandId),
    ]);

  const alerts: TeamAlert[] = [];

  // 1) Underperforming reps. Compute per-rep calls + appts, derive
  // conversion, compare to team-wide conversion. Only flag reps with
  // enough volume to be statistically meaningful.
  type Agg = { calls: number; appointments: number };
  const byMember = new Map<string, Agg>();
  for (const r of callsRes.data ?? []) {
    if (!r.member_id) continue;
    const a = byMember.get(r.member_id) ?? { calls: 0, appointments: 0 };
    a.calls += 1;
    byMember.set(r.member_id, a);
  }
  for (const a of apptsRes.data ?? []) {
    if (!a.member_id) continue;
    const cur = byMember.get(a.member_id) ?? { calls: 0, appointments: 0 };
    cur.appointments += 1;
    byMember.set(a.member_id, cur);
  }
  let totalCalls = 0;
  let totalAppts = 0;
  for (const a of byMember.values()) {
    totalCalls += a.calls;
    totalAppts += a.appointments;
  }
  const teamConv = totalCalls > 0 ? totalAppts / totalCalls : 0;
  const memberById = new Map<
    string,
    { full_name: string | null; email: string }
  >();
  for (const bm of membersRes.data ?? []) {
    memberById.set(bm.members.id, {
      full_name: bm.members.full_name,
      email: bm.members.email,
    });
  }
  if (teamConv > 0) {
    for (const [memberId, agg] of byMember) {
      if (agg.calls < MIN_CALLS_FOR_REP_FLAG) continue;
      const conv = agg.appointments / agg.calls;
      if (conv < teamConv * REP_UNDERPERFORM_FACTOR) {
        const m = memberById.get(memberId);
        if (!m) continue;
        alerts.push({
          kind: 'underperforming_rep',
          memberId,
          name: m.full_name ?? m.email,
          calls: agg.calls,
          conversionRate: conv,
          teamConversionRate: teamConv,
        });
      }
    }
  }

  // 2) Voicemail / missed inbound backlog.
  if (vmRes.data && vmRes.data.length > 0) {
    const oldest = vmRes.data[0]!;
    const oldestHours = Math.floor(
      (Date.now() - new Date(oldest.started_at).getTime()) / (60 * 60_000),
    );
    alerts.push({
      kind: 'voicemail_backlog',
      count: vmRes.data.length,
      oldestHours,
    });
  }

  // 3) Paused campaigns with recent calls. One follow-up query — we
  // wait until we know the paused-campaign ids so the IN list is bounded.
  const pausedIds = (pausedCampRes.data ?? []).map((c) => c.id);
  if (pausedIds.length > 0) {
    const { data: recentByCamp } = await supabase
      .from('calls')
      .select('campaign_id')
      .eq('brand_id', brandId)
      .in('campaign_id', pausedIds)
      .gte('started_at', sevenDaysAgoIso)
      .limit(5_000);
    const counts = new Map<string, number>();
    for (const r of recentByCamp ?? []) {
      if (!r.campaign_id) continue;
      counts.set(r.campaign_id, (counts.get(r.campaign_id) ?? 0) + 1);
    }
    for (const c of pausedCampRes.data ?? []) {
      const n = counts.get(c.id) ?? 0;
      if (n > 0) {
        alerts.push({
          kind: 'paused_with_activity',
          campaignId: c.id,
          name: c.name,
          callsLast7d: n,
        });
      }
    }
  }

  // 4) List exhaustion. We score every materialized list (filter lists
  // are dynamic and can't be "exhausted"). Cheap because the leads.list_id
  // index is hit and we just count buckets in JS.
  const matLists = (listsRes.data ?? []).filter((l) => l.source !== 'filter');
  if (matLists.length > 0) {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, list_id, do_not_call')
      .eq('brand_id', brandId)
      .in(
        'list_id',
        matLists.map((l) => l.id),
      )
      .limit(50_000);
    const leadIds = (leads ?? []).map((l) => l.id);
    let recentCalledIds = new Set<string>();
    if (leadIds.length > 0) {
      const { data: recentCalls } = await supabase
        .from('calls')
        .select('lead_id')
        .eq('brand_id', brandId)
        .gte('started_at', sevenDaysAgoIso)
        .in('lead_id', leadIds)
        .limit(50_000);
      recentCalledIds = new Set(
        (recentCalls ?? []).map((r) => r.lead_id as string).filter(Boolean),
      );
    }
    type ListAgg = { total: number; unreachable: number };
    const byList = new Map<string, ListAgg>();
    for (const l of leads ?? []) {
      if (!l.list_id) continue;
      const a = byList.get(l.list_id) ?? { total: 0, unreachable: 0 };
      a.total += 1;
      if (l.do_not_call || recentCalledIds.has(l.id)) a.unreachable += 1;
      byList.set(l.list_id, a);
    }
    for (const list of matLists) {
      const a = byList.get(list.id);
      if (!a || a.total < LIST_MIN_TOTAL) continue;
      const pct = a.unreachable / a.total;
      if (pct >= LIST_EXHAUSTED_THRESHOLD) {
        alerts.push({
          kind: 'list_exhausted',
          listId: list.id,
          name: list.name,
          totalLeads: a.total,
          unreachablePct: pct,
        });
      }
    }
  }

  // 5) SLA violations (Phase S). The cron at /api/cron/sla-tick keeps
  // this table at exactly the open set, so we render each row directly.
  for (const v of slaRes.data ?? []) {
    const m = memberById.get(v.member_id);
    if (!m) continue;
    const minutes =
      typeof (v.detail as { minutes?: number } | null)?.minutes === 'number'
        ? Math.max(0, Math.floor((v.detail as { minutes: number }).minutes))
        : 30;
    if (v.kind === 'agent_idle') {
      alerts.push({
        kind: 'agent_idle',
        memberId: v.member_id,
        name: m.full_name ?? m.email,
        minutes,
      });
    } else if (v.kind === 'no_calls_active') {
      alerts.push({
        kind: 'no_calls_active',
        memberId: v.member_id,
        name: m.full_name ?? m.email,
        minutes,
      });
    }
  }

  return { fromIso, toIso, alerts };
}
