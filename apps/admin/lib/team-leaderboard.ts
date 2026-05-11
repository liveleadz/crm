// Team leaderboard — windowed performance for every brand member at
// once. Mirrors the per-rep scorecard's metrics (dials, connects,
// connect %, talk, appts, conversion %) so the manager can sort and
// compare reps without drilling into each one.
import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import { rollingRangeBounds, type RollingRange } from './datetime';
import {
  DISPOSITION_CATEGORIES,
  loadCategoryByCode,
  type DispositionCategory,
} from './dispositions';
import type { MemberRole } from './team';

export type LeaderboardRange = RollingRange;

export type LeaderboardFilter = {
  range: LeaderboardRange;
  fromIso?: string | null;
  toIso?: string | null;
};

// Fixed-order category → count map. Always keyed for every category so
// the leaderboard table can render uniform columns even for members
// with zero outcomes in some buckets.
export type CategoryCounts = Record<DispositionCategory, number>;

function emptyCategoryCounts(): CategoryCounts {
  return DISPOSITION_CATEGORIES.reduce((acc, c) => {
    acc[c] = 0;
    return acc;
  }, {} as CategoryCounts);
}

export type LeaderboardRow = {
  memberId: string;
  fullName: string | null;
  email: string;
  role: MemberRole;
  isActive: boolean;
  calls: number;
  connects: number;
  connectRate: number;
  talkSec: number;
  appointments: number;
  conversionRate: number;
  // Per-category disposition breakdown. Counts include every call this
  // member made in the window, bucketed by the stable category axis
  // (so brand renames of "Connected" → "Closed" don't skew it).
  categories: CategoryCounts;
  // Total dispositioned calls (denominator for percentages). May be
  // less than `calls` if some rows have null disposition (e.g. still
  // in wrap-up at fetch time).
  dispositioned: number;
};

export type LeaderboardTotals = {
  calls: number;
  connects: number;
  connectRate: number;
  talkSec: number;
  appointments: number;
  conversionRate: number;
  categories: CategoryCounts;
  dispositioned: number;
};

export type Leaderboard = {
  fromIso: string;
  toIso: string;
  rows: LeaderboardRow[];
  totals: LeaderboardTotals;
};

export async function loadTeamLeaderboard(
  brandId: string,
  brandTimezone: string,
  filter: LeaderboardFilter,
): Promise<Leaderboard> {
  const supabase = await createServerClient();
  const { fromIso, toIso } = rollingRangeBounds(filter.range, brandTimezone, {
    fromIso: filter.fromIso ?? null,
    toIso: filter.toIso ?? null,
  });

  const [membersRes, callsRes, apptsRes, goodDispRes, categoryFor] = await Promise.all([
    supabase
      .from('brand_members')
      .select('role, is_active, members!inner(id, email, full_name)')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true }),
    supabase
      .from('calls')
      .select('member_id, disposition, duration_sec')
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
    supabase.from('dispositions').select('code').eq('brand_id', brandId).eq('tone', 'good'),
    loadCategoryByCode(brandId),
  ]);

  const goodCodes = new Set((goodDispRes.data ?? []).map((r) => r.code));

  type Agg = {
    calls: number;
    connects: number;
    talkSec: number;
    appointments: number;
    categories: CategoryCounts;
    dispositioned: number;
  };
  const newAgg = (): Agg => ({
    calls: 0,
    connects: 0,
    talkSec: 0,
    appointments: 0,
    categories: emptyCategoryCounts(),
    dispositioned: 0,
  });
  const byMember = new Map<string, Agg>();
  for (const r of callsRes.data ?? []) {
    if (!r.member_id) continue;
    const a = byMember.get(r.member_id) ?? newAgg();
    a.calls += 1;
    if (r.disposition && goodCodes.has(r.disposition)) a.connects += 1;
    a.talkSec += r.duration_sec ?? 0;
    if (r.disposition) {
      const cat = categoryFor(r.disposition);
      a.categories[cat] = (a.categories[cat] ?? 0) + 1;
      a.dispositioned += 1;
    }
    byMember.set(r.member_id, a);
  }
  for (const a of apptsRes.data ?? []) {
    if (!a.member_id) continue;
    const cur = byMember.get(a.member_id) ?? newAgg();
    cur.appointments += 1;
    byMember.set(a.member_id, cur);
  }

  const rows: LeaderboardRow[] = (membersRes.data ?? []).map((bm) => {
    const a = byMember.get(bm.members.id) ?? newAgg();
    return {
      memberId: bm.members.id,
      fullName: bm.members.full_name,
      email: bm.members.email,
      role: bm.role,
      isActive: bm.is_active,
      calls: a.calls,
      connects: a.connects,
      connectRate: a.calls > 0 ? a.connects / a.calls : 0,
      talkSec: a.talkSec,
      appointments: a.appointments,
      conversionRate: a.calls > 0 ? a.appointments / a.calls : 0,
      categories: a.categories,
      dispositioned: a.dispositioned,
    };
  });

  // Sort by dial volume by default — the manager's most common entry
  // point ("who's pulling weight?"). Client can re-sort interactively.
  rows.sort((a, b) => b.calls - a.calls);

  const totals: LeaderboardTotals = rows.reduce(
    (acc, r) => {
      acc.calls += r.calls;
      acc.connects += r.connects;
      acc.talkSec += r.talkSec;
      acc.appointments += r.appointments;
      acc.dispositioned += r.dispositioned;
      for (const cat of DISPOSITION_CATEGORIES) {
        acc.categories[cat] += r.categories[cat] ?? 0;
      }
      return acc;
    },
    {
      calls: 0,
      connects: 0,
      connectRate: 0,
      talkSec: 0,
      appointments: 0,
      conversionRate: 0,
      categories: emptyCategoryCounts(),
      dispositioned: 0,
    } as LeaderboardTotals,
  );
  totals.connectRate = totals.calls > 0 ? totals.connects / totals.calls : 0;
  totals.conversionRate = totals.calls > 0 ? totals.appointments / totals.calls : 0;

  return { fromIso, toIso, rows, totals };
}
