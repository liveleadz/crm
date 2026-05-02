// Per-rep performance scorecard. Aggregates the member's own calls +
// appointments inside the brand into today/week/month windows plus a
// 14-day sparkline and a per-campaign breakdown for the 30-day window.
//
// "Connected" tone is brand-config driven (matches `loadAgentCampaignSummary`
// and `loadCampaignReport`). Conversion = appointments booked / calls
// in the same window — the most direct dial→meeting ratio for a 1:1.
//
// Time windows are anchored to the brand's IANA timezone so a 9pm dial
// counts in tonight's bucket rather than tomorrow UTC.
import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import {
  addLocalDaysIso,
  getLocalParts,
  localDayKey,
  zonedToUtcIso,
} from './datetime';
import type { MemberRole } from './team';

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
  today: ScorecardWindow;
  week: ScorecardWindow;
  month: ScorecardWindow;
  // Last 14 days, oldest first. Always 14 entries even when sparse.
  sparkline: ScorecardSparkPoint[];
  // 30-day rollup. Campaigns the rep didn't touch in the window are
  // omitted to keep the table focused on real activity.
  byCampaign: ScorecardCampaign[];
};

function startOfLocalDay(now: Date, tz: string): string {
  const p = getLocalParts(now, tz);
  return zonedToUtcIso(p.year, p.month, p.day, 0, 0, 0, tz);
}

export async function loadScorecard(
  brandId: string,
  memberId: string,
  brandTimezone: string,
): Promise<Scorecard | null> {
  const supabase = await createServerClient();

  // Membership lookup also enforces brand scope — RLS will return null
  // for a member who doesn't belong to this brand.
  const { data: bm } = await supabase
    .from('brand_members')
    .select('role, members!inner(id, email, full_name)')
    .eq('brand_id', brandId)
    .eq('member_id', memberId)
    .maybeSingle();
  if (!bm) return null;

  const now = new Date();
  const todayStart = startOfLocalDay(now, brandTimezone);
  // Rolling, *inclusive of today*: 7-day window covers today + 6 prior;
  // 30-day covers today + 29 prior. Matches how managers eyeball the
  // last week / last month on a 1:1.
  const weekStart = addLocalDaysIso(todayStart, -6, brandTimezone);
  const monthStart = addLocalDaysIso(todayStart, -29, brandTimezone);
  const sparkStart = addLocalDaysIso(todayStart, -13, brandTimezone);

  const [callsRes, apptsRes, goodDispRes, campsRes] = await Promise.all([
    supabase
      .from('calls')
      .select('campaign_id, disposition, duration_sec, started_at')
      .eq('brand_id', brandId)
      .eq('member_id', memberId)
      .gte('started_at', monthStart)
      .limit(50_000),
    supabase
      .from('appointments')
      .select('campaign_id, created_at')
      .eq('brand_id', brandId)
      .eq('member_id', memberId)
      .gte('created_at', monthStart)
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

  type Agg = { calls: number; connects: number; talkSec: number; appointments: number };
  const empty = (): Agg => ({ calls: 0, connects: 0, talkSec: 0, appointments: 0 });
  const today = empty();
  const week = empty();
  const month = empty();

  for (const r of callsRes.data ?? []) {
    const dur = r.duration_sec ?? 0;
    const isConnect = r.disposition && goodCodes.has(r.disposition) ? 1 : 0;
    month.calls += 1;
    month.connects += isConnect;
    month.talkSec += dur;
    if (r.started_at >= weekStart) {
      week.calls += 1;
      week.connects += isConnect;
      week.talkSec += dur;
    }
    if (r.started_at >= todayStart) {
      today.calls += 1;
      today.connects += isConnect;
      today.talkSec += dur;
    }
  }
  for (const a of apptsRes.data ?? []) {
    month.appointments += 1;
    if (a.created_at >= weekStart) week.appointments += 1;
    if (a.created_at >= todayStart) today.appointments += 1;
  }

  const shape = (a: Agg): ScorecardWindow => ({
    calls: a.calls,
    connects: a.connects,
    connectRate: a.calls > 0 ? a.connects / a.calls : 0,
    talkSec: a.talkSec,
    appointments: a.appointments,
    conversionRate: a.calls > 0 ? a.appointments / a.calls : 0,
  });

  // Sparkline: enumerate 14 brand-local days so the chart has a stable
  // x-axis even when the rep had zero dials some days.
  const sparkMap = new Map<string, { calls: number; connects: number }>();
  for (let i = -13; i <= 0; i += 1) {
    const dayIso = addLocalDaysIso(todayStart, i, brandTimezone);
    sparkMap.set(localDayKey(dayIso, brandTimezone), { calls: 0, connects: 0 });
  }
  for (const r of callsRes.data ?? []) {
    if (r.started_at < sparkStart) continue;
    const key = localDayKey(r.started_at, brandTimezone);
    const cell = sparkMap.get(key);
    if (!cell) continue;
    cell.calls += 1;
    if (r.disposition && goodCodes.has(r.disposition)) cell.connects += 1;
  }
  const sparkline: ScorecardSparkPoint[] = Array.from(sparkMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, calls: v.calls, connects: v.connects }));

  // Per-campaign rollup over the 30-day window. Combines call counts
  // with appointments so a manager can spot which campaign a rep is
  // converting (or stalling) inside.
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
    today: shape(today),
    week: shape(week),
    month: shape(month),
    sparkline,
    byCampaign,
  };
}
