// Per-rep performance scorecard. Aggregates the member's own calls +
// appointments inside a rolling window into a single set of KPIs plus a
// daily sparkline and a per-campaign breakdown. Filter is set by the
// caller (page reads it from search params) so the UI can swap windows
// without re-mounting.
//
// "Connected" tone is brand-config driven. Conversion = appointments
// booked / calls in the window — most direct dial→meeting ratio for a
// 1:1.

import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import {
  addDaysToDateKey,
  localDayKey,
  rollingRangeBounds,
  type RollingRange,
} from './datetime';
import type { MemberRole } from './team';

export type ScorecardRange = RollingRange;

export type ScorecardFilter = {
  range: ScorecardRange;
  fromIso?: string | null;
  toIso?: string | null;
};

export type ScorecardWindow = {
  calls: number;
  connects: number;
  connectRate: number; // 0..1
  talkSec: number;
  appointments: number;
  conversionRate: number; // appointments / calls, 0..1
};

export type ScorecardCampaign = {
  campaignId: string;
  name: string;
  status: string;
  calls: number;
  connects: number;
  appointments: number;
};

export type ScorecardSparkPoint = {
  date: string; // YYYY-MM-DD in brand-local tz
  calls: number;
  connects: number;
};

export type Scorecard = {
  member: {
    id: string;
    fullName: string | null;
    email: string;
    role: MemberRole;
  };
  fromIso: string;
  toIso: string;
  window: ScorecardWindow;
  // One bar per brand-local day across the filter window. Empty for the
  // 1-day range (a single bar is uninformative).
  sparkline: ScorecardSparkPoint[];
  byCampaign: ScorecardCampaign[];
};

export async function loadScorecard(
  brandId: string,
  memberId: string,
  brandTimezone: string,
  filter: ScorecardFilter,
): Promise<Scorecard | null> {
  const supabase = await createServerClient();

  const { data: bm } = await supabase
    .from('brand_members')
    .select('role, members!inner(id, email, full_name)')
    .eq('brand_id', brandId)
    .eq('member_id', memberId)
    .maybeSingle();
  if (!bm) return null;

  const { fromIso, toIso } = rollingRangeBounds(filter.range, brandTimezone, {
    fromIso: filter.fromIso ?? null,
    toIso: filter.toIso ?? null,
  });

  const [callsRes, apptsRes, goodDispRes, campsRes] = await Promise.all([
    supabase
      .from('calls')
      .select('campaign_id, disposition, duration_sec, started_at')
      .eq('brand_id', brandId)
      .eq('member_id', memberId)
      .gte('started_at', fromIso)
      .lte('started_at', toIso)
      .limit(50_000),
    supabase
      .from('appointments')
      .select('campaign_id, created_at')
      .eq('brand_id', brandId)
      .eq('member_id', memberId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso)
      .limit(10_000),
    supabase
      .from('dispositions')
      .select('code')
      .eq('brand_id', brandId)
      .eq('tone', 'good'),
    supabase.from('campaigns').select('id, name, status').eq('brand_id', brandId),
  ]);

  const goodCodes = new Set((goodDispRes.data ?? []).map((r) => r.code));
  const campMap = new Map<string, { name: string; status: string }>(
    (campsRes.data ?? []).map((c) => [c.id, { name: c.name, status: c.status }]),
  );

  let calls = 0;
  let connects = 0;
  let talkSec = 0;
  for (const r of callsRes.data ?? []) {
    calls += 1;
    if (r.disposition && goodCodes.has(r.disposition)) connects += 1;
    talkSec += r.duration_sec ?? 0;
  }
  const appointments = apptsRes.data?.length ?? 0;
  const window: ScorecardWindow = {
    calls,
    connects,
    connectRate: calls > 0 ? connects / calls : 0,
    talkSec,
    appointments,
    conversionRate: calls > 0 ? appointments / calls : 0,
  };

  // Sparkline: enumerate every brand-local day from fromIso..toIso so
  // gaps render as zero-bars instead of missing ticks. Skipped for the
  // 1-day filter where a single bar is noise.
  let sparkline: ScorecardSparkPoint[] = [];
  if (filter.range !== '1d') {
    const sparkMap = new Map<string, { calls: number; connects: number }>();
    const startKey = localDayKey(fromIso, brandTimezone);
    const endKey = localDayKey(toIso, brandTimezone);
    let cursor = startKey;
    // Bounded loop: 366 days for safety on custom ranges.
    for (let guard = 0; guard < 366 && cursor <= endKey; guard += 1) {
      sparkMap.set(cursor, { calls: 0, connects: 0 });
      cursor = addDaysToDateKey(cursor, 1);
    }
    for (const r of callsRes.data ?? []) {
      const key = localDayKey(r.started_at, brandTimezone);
      const cell = sparkMap.get(key);
      if (!cell) continue;
      cell.calls += 1;
      if (r.disposition && goodCodes.has(r.disposition)) cell.connects += 1;
    }
    sparkline = Array.from(sparkMap.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({ date, calls: v.calls, connects: v.connects }));
  }

  // Per-campaign rollup over the same window.
  type CampAgg = { calls: number; connects: number; appointments: number };
  const byCampMap = new Map<string, CampAgg>();
  for (const r of callsRes.data ?? []) {
    if (!r.campaign_id) continue;
    const cur = byCampMap.get(r.campaign_id) ?? { calls: 0, connects: 0, appointments: 0 };
    cur.calls += 1;
    if (r.disposition && goodCodes.has(r.disposition)) cur.connects += 1;
    byCampMap.set(r.campaign_id, cur);
  }
  for (const a of apptsRes.data ?? []) {
    if (!a.campaign_id) continue;
    const cur = byCampMap.get(a.campaign_id) ?? { calls: 0, connects: 0, appointments: 0 };
    cur.appointments += 1;
    byCampMap.set(a.campaign_id, cur);
  }
  const byCampaign: ScorecardCampaign[] = Array.from(byCampMap.entries())
    .map(([campaignId, v]) => {
      const meta = campMap.get(campaignId);
      return {
        campaignId,
        name: meta?.name ?? 'Unknown campaign',
        status: meta?.status ?? 'archived',
        calls: v.calls,
        connects: v.connects,
        appointments: v.appointments,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  return {
    member: {
      id: bm.members.id,
      fullName: bm.members.full_name,
      email: bm.members.email,
      role: bm.role,
    },
    fromIso,
    toIso,
    window,
    sparkline,
    byCampaign,
  };
}

