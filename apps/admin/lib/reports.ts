import 'server-only';
// Reports data layer — aggregates rows from `calls` for the active brand
// over a date range and shapes them into the buckets the UI renders:
// KPI tiles, per-agent table, disposition breakdown, daily trend.
//
// All counts are derived in-process from a single calls query (the
// reports volume per brand is bounded; we keep it simple instead of
// pushing aggregations into Postgres). Brand-scoped via RLS plus an
// explicit brand_id filter.

import { createServerClient } from '@leadpilot/db/server';

export type ReportRange = '7d' | '30d' | '90d' | 'custom';
export type DirectionFilter = 'all' | 'inbound' | 'outbound';

export type ReportFilter = {
  range: ReportRange;
  /** ISO timestamps; only used when range='custom'. */
  fromIso?: string | null;
  toIso?: string | null;
  agentId?: string | null;
  direction?: DirectionFilter;
};

export type ReportKpis = {
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  connectedCalls: number;
  connectRate: number;          // 0..1
  totalTalkSec: number;
  avgTalkSec: number;
  salesCount: number;
  salesRate: number;            // 0..1
  voicemailCount: number;
  callbackCount: number;
};

export type AgentRow = {
  memberId: string;
  name: string;
  email: string;
  calls: number;
  connects: number;
  connectRate: number;
  totalTalkSec: number;
  avgTalkSec: number;
  sales: number;
  salesRate: number;
};

export type DispositionRow = {
  code: string;
  count: number;
  pct: number;                  // 0..1, share of all dispositioned calls
};

export type TrendPoint = {
  date: string;                 // YYYY-MM-DD in brand-naive UTC bucket
  calls: number;
  connects: number;
};

export type CallReport = {
  fromIso: string;
  toIso: string;
  kpis: ReportKpis;
  byAgent: AgentRow[];
  byDisposition: DispositionRow[];
  trend: TrendPoint[];
};

const DAY_MS = 86_400_000;

// Connected-equivalent dispositions — used for connect rate, avg talk
// time denominator when we want "of calls that actually went through",
// and the daily trend's "connects" series.
const CONNECTED_CODES = new Set(['connected', 'sale', 'callback', 'not_interested']);

function rangeBounds(filter: ReportFilter): { fromIso: string; toIso: string } {
  const now = Date.now();
  if (filter.range === 'custom' && filter.fromIso && filter.toIso) {
    return { fromIso: filter.fromIso, toIso: filter.toIso };
  }
  const days = filter.range === '7d' ? 7 : filter.range === '90d' ? 90 : 30;
  const from = new Date(now - days * DAY_MS);
  const to = new Date(now);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function bucketDate(iso: string): string {
  // Naive UTC day bucket. Good enough for a daily trend; adopting brand
  // timezone is a follow-up that doesn't change the API shape.
  return iso.slice(0, 10);
}

export async function loadCallReport(
  brandId: string,
  filter: ReportFilter,
): Promise<CallReport> {
  const supabase = await createServerClient();
  const { fromIso, toIso } = rangeBounds(filter);

  let query = supabase
    .from('calls')
    .select('id, member_id, direction, disposition, duration_sec, started_at')
    .eq('brand_id', brandId)
    .gte('started_at', fromIso)
    .lte('started_at', toIso)
    .order('started_at', { ascending: true })
    // Hard cap so a runaway brand doesn't blow up the page. 50k rows
    // covers ~5 months of heavy dialing for one brand; if a real
    // workload exceeds this we'll move aggregation into Postgres.
    .limit(50_000);

  if (filter.agentId) query = query.eq('member_id', filter.agentId);
  if (filter.direction && filter.direction !== 'all') {
    query = query.eq('direction', filter.direction);
  }

  const { data: calls } = await query;
  const rows = calls ?? [];

  // Member lookup for the per-agent table. We only fetch member rows
  // referenced by these calls (small, bounded set).
  const memberIds = Array.from(
    new Set(rows.map((r) => r.member_id).filter((m): m is string => !!m)),
  );
  let memberById = new Map<string, { fullName: string | null; email: string }>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, email, full_name')
      .in('id', memberIds);
    memberById = new Map(
      (members ?? []).map((m) => [
        m.id,
        { fullName: m.full_name, email: m.email },
      ]),
    );
  }

  // ---------- KPIs ----------
  let inboundCalls = 0;
  let outboundCalls = 0;
  let connectedCalls = 0;
  let totalTalkSec = 0;
  let salesCount = 0;
  let voicemailCount = 0;
  let callbackCount = 0;

  for (const r of rows) {
    if (r.direction === 'inbound') inboundCalls += 1;
    else outboundCalls += 1;
    if (r.disposition && CONNECTED_CODES.has(r.disposition)) connectedCalls += 1;
    if (r.disposition === 'sale') salesCount += 1;
    if (r.disposition === 'voicemail') voicemailCount += 1;
    if (r.disposition === 'callback') callbackCount += 1;
    totalTalkSec += r.duration_sec ?? 0;
  }

  const totalCalls = rows.length;
  const connectRate = totalCalls > 0 ? connectedCalls / totalCalls : 0;
  const salesRate = totalCalls > 0 ? salesCount / totalCalls : 0;
  // Avg talk over connected calls only — averaging in zero-duration
  // missed calls would suppress the headline number to noise.
  const avgTalkSec = connectedCalls > 0 ? Math.round(totalTalkSec / connectedCalls) : 0;

  const kpis: ReportKpis = {
    totalCalls,
    inboundCalls,
    outboundCalls,
    connectedCalls,
    connectRate,
    totalTalkSec,
    avgTalkSec,
    salesCount,
    salesRate,
    voicemailCount,
    callbackCount,
  };

  // ---------- By agent ----------
  type AgentAgg = {
    calls: number;
    connects: number;
    talkSec: number;
    sales: number;
  };
  const byAgentMap = new Map<string, AgentAgg>();
  for (const r of rows) {
    if (!r.member_id) continue;
    const a = byAgentMap.get(r.member_id) ?? {
      calls: 0,
      connects: 0,
      talkSec: 0,
      sales: 0,
    };
    a.calls += 1;
    if (r.disposition && CONNECTED_CODES.has(r.disposition)) a.connects += 1;
    if (r.disposition === 'sale') a.sales += 1;
    a.talkSec += r.duration_sec ?? 0;
    byAgentMap.set(r.member_id, a);
  }
  const byAgent: AgentRow[] = Array.from(byAgentMap.entries())
    .map(([memberId, a]) => {
      const m = memberById.get(memberId);
      const name = m?.fullName?.trim() || m?.email || 'Unknown agent';
      return {
        memberId,
        name,
        email: m?.email ?? '',
        calls: a.calls,
        connects: a.connects,
        connectRate: a.calls > 0 ? a.connects / a.calls : 0,
        totalTalkSec: a.talkSec,
        avgTalkSec: a.connects > 0 ? Math.round(a.talkSec / a.connects) : 0,
        sales: a.sales,
        salesRate: a.calls > 0 ? a.sales / a.calls : 0,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  // ---------- By disposition ----------
  const dispMap = new Map<string, number>();
  let dispositioned = 0;
  for (const r of rows) {
    if (!r.disposition) continue;
    dispMap.set(r.disposition, (dispMap.get(r.disposition) ?? 0) + 1);
    dispositioned += 1;
  }
  const byDisposition: DispositionRow[] = Array.from(dispMap.entries())
    .map(([code, count]) => ({
      code,
      count,
      pct: dispositioned > 0 ? count / dispositioned : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // ---------- Daily trend ----------
  // Build a complete date axis from fromIso..toIso so days with zero
  // calls still render a tick (otherwise the line jumps gaps).
  const startMs = Math.floor(new Date(fromIso).getTime() / DAY_MS) * DAY_MS;
  const endMs = Math.floor(new Date(toIso).getTime() / DAY_MS) * DAY_MS;
  const trendMap = new Map<string, { calls: number; connects: number }>();
  for (let t = startMs; t <= endMs; t += DAY_MS) {
    trendMap.set(new Date(t).toISOString().slice(0, 10), { calls: 0, connects: 0 });
  }
  for (const r of rows) {
    const key = bucketDate(r.started_at);
    const cur = trendMap.get(key);
    if (!cur) continue;
    cur.calls += 1;
    if (r.disposition && CONNECTED_CODES.has(r.disposition)) cur.connects += 1;
  }
  const trend: TrendPoint[] = Array.from(trendMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, calls: v.calls, connects: v.connects }));

  return { fromIso, toIso, kpis, byAgent, byDisposition, trend };
}

// Friendly disposition labels — keep in sync with /lib/dispositions.
export const DISPOSITION_LABELS: Record<string, string> = {
  connected: 'Connected',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  wrong_number: 'Wrong number',
  do_not_call: 'Do not call',
  callback: 'Callback',
  sale: 'Sale',
  not_interested: 'Not interested',
};

export function dispositionLabel(code: string): string {
  return DISPOSITION_LABELS[code] ?? code;
}

export function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
