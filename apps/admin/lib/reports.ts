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
import { addDaysToDateKey, getLocalParts, localDayKey } from './datetime';
import {
  CONNECTED_CATEGORIES,
  loadCategoryByCode,
  type DispositionCategory,
} from './dispositions';

export type ReportRange = '7d' | '30d' | '90d' | 'custom';
export type DirectionFilter = 'all' | 'inbound' | 'outbound';

export type ReportFilter = {
  range: ReportRange;
  /** ISO timestamps; only used when range='custom'. */
  fromIso?: string | null;
  toIso?: string | null;
  agentId?: string | null;
  /** When set, restrict the report to a single campaign. Used by the
   * per-campaign performance page (Phase P) to drive the same KPIs/
   * trend/heatmap from one campaign's slice of `calls`. */
  campaignId?: string | null;
  direction?: DirectionFilter;
  /** IANA tz used to bucket the trend (per-day) and heatmap (dow×hour).
   *  Falls back to UTC when omitted. */
  timezone?: string | null;
  /** When set, force every report query to filter by this member id —
   * regardless of any agentId in the URL. Pages set this to the caller's
   * own member id when the role is agent/viewer so a colleague's id in
   * `?agent=` can't be used to peek at their numbers. */
  viewerMemberId?: string | null;
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
  // Category-based counts (Phase M). Source of truth for the disposition
  // taxonomy now lives on dispositions.category, so these are stable
  // even when a brand renames its codes/labels.
  voicemailCount: number;
  callbackCount: number;
  wrongNumberCount: number;
  noAnswerCount: number;
  appointmentSetCount: number;
  notInterestedCount: number;
  doNotCallCount: number;
  // Per-category rates over total calls. Rendered as the headline
  // "% wrong number, % no answer, % appointment set" strip.
  voicemailRate: number;
  callbackRate: number;
  wrongNumberRate: number;
  noAnswerRate: number;
  appointmentSetRate: number;
  notInterestedRate: number;
  doNotCallRate: number;
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
  date: string;                 // YYYY-MM-DD in the brand's local tz
  calls: number;
  connects: number;
};

export type SourceRow = {
  source: string;               // lead source code, or 'unknown'
  calls: number;
  connects: number;
  connectRate: number;
  sales: number;
  salesRate: number;
};

export type HeatmapCell = {
  dow: number;                  // 0=Sun..6=Sat
  hour: number;                 // 0..23
  calls: number;
  connects: number;
};

export type CallReport = {
  fromIso: string;
  toIso: string;
  kpis: ReportKpis;
  /** KPIs over the equal-length window immediately preceding the current
   * range. Null when the loader was not asked to compute it. */
  prevKpis: ReportKpis | null;
  byAgent: AgentRow[];
  byDisposition: DispositionRow[];
  bySource: SourceRow[];
  heatmap: HeatmapCell[];
  trend: TrendPoint[];
};

const DAY_MS = 86_400_000;

// Helper: a code → category lookup function, falling back to 'other'
// for unknown codes. Loaded once per report request via
// `loadCategoryByCode(brandId)`.
type CategoryLookup = (code: string | null | undefined) => DispositionCategory;

// Apply the viewer self-scope: when the page passes a viewerMemberId
// (because the caller is an agent/viewer), force the report's agentId
// to that member — overwriting any value the URL or caller supplied.
// Centralizes the rule so every report loader ends up self-scoped
// without each one re-implementing the override.
function effectiveFilter(filter: ReportFilter): ReportFilter {
  if (filter.viewerMemberId) {
    return { ...filter, agentId: filter.viewerMemberId };
  }
  return filter;
}

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

// KPI roll-up over a flat set of rows. Extracted so the prev-period
// loader can reuse it without re-implementing the headline math.
type CallRow = {
  direction: string | null;
  disposition: string | null;
  duration_sec: number | null;
};

function computeKpis(rows: CallRow[], categoryFor: CategoryLookup): ReportKpis {
  let inboundCalls = 0;
  let outboundCalls = 0;
  let connectedCalls = 0;
  let totalTalkSec = 0;
  let salesCount = 0;
  // Category buckets.
  let voicemailCount = 0;
  let callbackCount = 0;
  let wrongNumberCount = 0;
  let noAnswerCount = 0;
  let appointmentSetCount = 0;
  let notInterestedCount = 0;
  let doNotCallCount = 0;
  for (const r of rows) {
    if (r.direction === 'inbound') inboundCalls += 1;
    else outboundCalls += 1;
    const cat = categoryFor(r.disposition);
    if (CONNECTED_CATEGORIES.has(cat)) connectedCalls += 1;
    if (r.disposition === 'sale') salesCount += 1;
    if (cat === 'voicemail') voicemailCount += 1;
    if (cat === 'callback') callbackCount += 1;
    if (cat === 'wrong_number') wrongNumberCount += 1;
    if (cat === 'no_answer') noAnswerCount += 1;
    if (cat === 'appointment_set') appointmentSetCount += 1;
    if (cat === 'not_interested') notInterestedCount += 1;
    if (cat === 'do_not_call') doNotCallCount += 1;
    totalTalkSec += r.duration_sec ?? 0;
  }
  const totalCalls = rows.length;
  const rate = (n: number) => (totalCalls > 0 ? n / totalCalls : 0);
  return {
    totalCalls,
    inboundCalls,
    outboundCalls,
    connectedCalls,
    connectRate: rate(connectedCalls),
    totalTalkSec,
    avgTalkSec: connectedCalls > 0 ? Math.round(totalTalkSec / connectedCalls) : 0,
    salesCount,
    salesRate: rate(salesCount),
    voicemailCount,
    callbackCount,
    wrongNumberCount,
    noAnswerCount,
    appointmentSetCount,
    notInterestedCount,
    doNotCallCount,
    voicemailRate: rate(voicemailCount),
    callbackRate: rate(callbackCount),
    wrongNumberRate: rate(wrongNumberCount),
    noAnswerRate: rate(noAnswerCount),
    appointmentSetRate: rate(appointmentSetCount),
    notInterestedRate: rate(notInterestedCount),
    doNotCallRate: rate(doNotCallCount),
  };
}

export async function loadCallReport(
  brandId: string,
  filterIn: ReportFilter,
): Promise<CallReport> {
  const filter = effectiveFilter(filterIn);
  const supabase = await createServerClient();
  const { fromIso, toIso } = rangeBounds(filter);
  // Default to UTC when no tz is provided so callers (e.g. CSV export)
  // that don't care about presentation continue to work.
  const tz = filter.timezone || 'UTC';

  let query = supabase
    .from('calls')
    .select('id, member_id, lead_id, direction, disposition, duration_sec, started_at')
    .eq('brand_id', brandId)
    .gte('started_at', fromIso)
    .lte('started_at', toIso)
    .order('started_at', { ascending: true })
    // Hard cap so a runaway brand doesn't blow up the page. 50k rows
    // covers ~5 months of heavy dialing for one brand; if a real
    // workload exceeds this we'll move aggregation into Postgres.
    .limit(50_000);

  if (filter.agentId) query = query.eq('member_id', filter.agentId);
  if (filter.campaignId) query = query.eq('campaign_id', filter.campaignId);
  if (filter.direction && filter.direction !== 'all') {
    query = query.eq('direction', filter.direction);
  }

  const { data: calls } = await query;
  const rows = calls ?? [];

  // Brand-specific code → category lookup. Loaded once per request and
  // reused for all rollups (KPIs, per-agent, by-source, heatmap, trend,
  // prev-period). Falls back to 'other' for unmapped codes.
  const categoryFor = await loadCategoryByCode(brandId);
  const isConnect = (code: string | null | undefined) =>
    CONNECTED_CATEGORIES.has(categoryFor(code));

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
  const kpis = computeKpis(rows, categoryFor);

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
    if (isConnect(r.disposition)) a.connects += 1;
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

  // ---------- By lead source ----------
  // Pulls leads.source for the lead_ids referenced by these calls. A
  // call can have a null lead_id (e.g. inbound from an unknown number);
  // we bucket those under 'unknown'.
  const leadIds = Array.from(
    new Set(rows.map((r) => r.lead_id).filter((l): l is string => !!l)),
  );
  const sourceByLeadId = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, source')
      .in('id', leadIds);
    for (const l of leads ?? []) {
      if (l.source) sourceByLeadId.set(l.id, l.source);
    }
  }
  type SourceAgg = { calls: number; connects: number; sales: number };
  const sourceMap = new Map<string, SourceAgg>();
  for (const r of rows) {
    const key = (r.lead_id && sourceByLeadId.get(r.lead_id)) || 'unknown';
    const a = sourceMap.get(key) ?? { calls: 0, connects: 0, sales: 0 };
    a.calls += 1;
    if (isConnect(r.disposition)) a.connects += 1;
    if (r.disposition === 'sale') a.sales += 1;
    sourceMap.set(key, a);
  }
  const bySource: SourceRow[] = Array.from(sourceMap.entries())
    .map(([source, a]) => ({
      source,
      calls: a.calls,
      connects: a.connects,
      connectRate: a.calls > 0 ? a.connects / a.calls : 0,
      sales: a.sales,
      salesRate: a.calls > 0 ? a.sales / a.calls : 0,
    }))
    .sort((a, b) => b.calls - a.calls);

  // ---------- Day-of-week × hour-of-day heatmap ----------
  // Bucketing uses brand-local time so 9am Monday means 9am in the
  // brand's tz — not UTC. We keep all 168 cells (7×24) so the renderer
  // can draw a stable grid even when buckets are sparse.
  const heatmap: HeatmapCell[] = [];
  const heatIndex = new Map<string, HeatmapCell>();
  for (let dow = 0; dow < 7; dow += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const cell: HeatmapCell = { dow, hour, calls: 0, connects: 0 };
      heatmap.push(cell);
      heatIndex.set(`${dow}:${hour}`, cell);
    }
  }
  for (const r of rows) {
    const lp = getLocalParts(r.started_at, tz);
    const cell = heatIndex.get(`${lp.weekday}:${lp.hour}`);
    if (!cell) continue;
    cell.calls += 1;
    if (isConnect(r.disposition)) cell.connects += 1;
  }

  // ---------- Daily trend ----------
  // Build a complete date axis from fromIso..toIso so days with zero
  // calls still render a tick (otherwise the line jumps gaps). Days are
  // brand-local — fromIso's local day through toIso's local day,
  // inclusive.
  const startKey = localDayKey(fromIso, tz);
  const endKey = localDayKey(toIso, tz);
  const trendMap = new Map<string, { calls: number; connects: number }>();
  for (let cursor = startKey; cursor <= endKey; cursor = addDaysToDateKey(cursor, 1)) {
    trendMap.set(cursor, { calls: 0, connects: 0 });
  }
  for (const r of rows) {
    const key = localDayKey(r.started_at, tz);
    const cur = trendMap.get(key);
    if (!cur) continue;
    cur.calls += 1;
    if (isConnect(r.disposition)) cur.connects += 1;
  }
  const trend: TrendPoint[] = Array.from(trendMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, calls: v.calls, connects: v.connects }));

  // ---------- Prev-period KPIs ----------
  // Same length immediately preceding the current window. We only need
  // the headline numbers, so the query selects just enough columns to
  // run computeKpis(); per-agent/per-disposition aggregates are skipped.
  const startMsBound = new Date(fromIso).getTime();
  const endMsBound = new Date(toIso).getTime();
  const windowMs = Math.max(1, endMsBound - startMsBound);
  const prevToIso = new Date(startMsBound - 1).toISOString();
  const prevFromIso = new Date(startMsBound - 1 - windowMs).toISOString();

  let prevQuery = supabase
    .from('calls')
    .select('direction, disposition, duration_sec')
    .eq('brand_id', brandId)
    .gte('started_at', prevFromIso)
    .lte('started_at', prevToIso)
    .limit(50_000);
  if (filter.agentId) prevQuery = prevQuery.eq('member_id', filter.agentId);
  if (filter.campaignId) prevQuery = prevQuery.eq('campaign_id', filter.campaignId);
  if (filter.direction && filter.direction !== 'all') {
    prevQuery = prevQuery.eq('direction', filter.direction);
  }
  const { data: prevRows } = await prevQuery;
  const prevKpis = computeKpis(prevRows ?? [], categoryFor);

  return {
    fromIso,
    toIso,
    kpis,
    prevKpis,
    byAgent,
    byDisposition,
    bySource,
    heatmap,
    trend,
  };
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

// ---------------------------------------------------------------------------
// Email report (Phase B)
// ---------------------------------------------------------------------------

export type EmailKpis = {
  sent: number;
  received: number;
  threadsOpen: number;
  replyRate: number;
  avgResponseMin: number;
};

export type EmailAgentRow = {
  memberId: string;
  name: string;
  email: string;
  sent: number;
  received: number;
  replied: number;
  replyRate: number;
  avgResponseMin: number;
};

export type EmailTrendPoint = {
  date: string;
  sent: number;
  received: number;
};

export type EmailReport = {
  fromIso: string;
  toIso: string;
  kpis: EmailKpis;
  perAgent: EmailAgentRow[];
  trend: EmailTrendPoint[];
};

export async function loadEmailReport(
  brandId: string,
  filterIn: ReportFilter,
): Promise<EmailReport> {
  const filter = effectiveFilter(filterIn);
  const supabase = await createServerClient();
  const { fromIso, toIso } = rangeBounds(filter);
  const tz = filter.timezone || 'UTC';

  // Fetch threads for the brand. We need thread→member mapping to attribute
  // outbound sends and inbound receipts to the right agent. When the
  // caller is self-scoped (agent/viewer or explicit ?agent=…), narrow
  // to threads owned by that member so the KPIs reflect only their work.
  let threadQuery = supabase
    .from('email_threads')
    .select('id, member_id, last_message_at')
    .eq('brand_id', brandId);
  if (filter.agentId) threadQuery = threadQuery.eq('member_id', filter.agentId);
  const { data: threads } = await threadQuery;
  const threadRows = threads ?? [];
  const threadIds = threadRows.map((t) => t.id);
  const threadOwner = new Map(threadRows.map((t) => [t.id, t.member_id]));

  if (threadIds.length === 0) {
    const dayKeys = buildEmptyTrend(fromIso, toIso, tz);
    return {
      fromIso,
      toIso,
      kpis: { sent: 0, received: 0, threadsOpen: 0, replyRate: 0, avgResponseMin: 0 },
      perAgent: [],
      trend: dayKeys.map((d) => ({ date: d, sent: 0, received: 0 })),
    };
  }

  const { data: msgs } = await supabase
    .from('email_messages')
    .select('id, thread_id, direction, sent_at')
    .in('thread_id', threadIds)
    .gte('sent_at', fromIso)
    .lte('sent_at', toIso)
    .order('sent_at', { ascending: true })
    .limit(50_000);
  const rows = msgs ?? [];

  // Threads-open = threads with last_message_at inside the window. Cheap heuristic.
  let threadsOpen = 0;
  for (const t of threadRows) {
    if (!t.last_message_at) continue;
    if (t.last_message_at < fromIso || t.last_message_at > toIso) continue;
    threadsOpen += 1;
  }

  let sent = 0;
  let received = 0;
  for (const r of rows) {
    if (r.direction === 'outbound') sent += 1;
    else if (r.direction === 'inbound') received += 1;
  }

  // Reply analysis: walk each thread chronologically. For every outbound
  // message, look for the next inbound within 14 days; if found, count the
  // reply and accumulate response time.
  const REPLY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  type Msg = { id: string; thread_id: string; direction: string; sent_at: string };
  const byThread = new Map<string, Msg[]>();
  for (const r of rows) {
    const arr = byThread.get(r.thread_id) ?? [];
    arr.push(r);
    byThread.set(r.thread_id, arr);
  }
  let outboundWithReply = 0;
  let outboundForReplyDenom = 0;
  let totalResponseMs = 0;
  let responseSamples = 0;
  type AgentAgg = { sent: number; received: number; replied: number; respMs: number; respN: number };
  const agentMap = new Map<string, AgentAgg>();

  for (const [threadId, threadMsgs] of byThread.entries()) {
    threadMsgs.sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1));
    const ownerId = threadOwner.get(threadId) ?? null;
    if (ownerId) {
      const a = agentMap.get(ownerId) ?? { sent: 0, received: 0, replied: 0, respMs: 0, respN: 0 };
      for (const m of threadMsgs) {
        if (m.direction === 'outbound') a.sent += 1;
        else if (m.direction === 'inbound') a.received += 1;
      }
      agentMap.set(ownerId, a);
    }
    for (let i = 0; i < threadMsgs.length; i += 1) {
      const m = threadMsgs[i];
      if (!m || m.direction !== 'outbound') continue;
      outboundForReplyDenom += 1;
      const sentMs = new Date(m.sent_at).getTime();
      for (let j = i + 1; j < threadMsgs.length; j += 1) {
        const next = threadMsgs[j];
        if (!next || next.direction !== 'inbound') continue;
        const replyMs = new Date(next.sent_at).getTime();
        if (replyMs - sentMs > REPLY_WINDOW_MS) break;
        outboundWithReply += 1;
        totalResponseMs += replyMs - sentMs;
        responseSamples += 1;
        if (ownerId) {
          const a = agentMap.get(ownerId)!;
          a.replied += 1;
          a.respMs += replyMs - sentMs;
          a.respN += 1;
        }
        break;
      }
    }
  }

  const replyRate = outboundForReplyDenom > 0 ? outboundWithReply / outboundForReplyDenom : 0;
  const avgResponseMin = responseSamples > 0 ? Math.round(totalResponseMs / responseSamples / 60000) : 0;

  const memberIds = Array.from(agentMap.keys());
  const memberById = new Map<string, { fullName: string | null; email: string }>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, full_name, email')
      .in('id', memberIds);
    for (const m of members ?? []) memberById.set(m.id, { fullName: m.full_name, email: m.email });
  }
  const perAgent: EmailAgentRow[] = Array.from(agentMap.entries())
    .map(([memberId, a]) => {
      const m = memberById.get(memberId);
      return {
        memberId,
        name: m?.fullName?.trim() || m?.email || 'Unknown agent',
        email: m?.email ?? '',
        sent: a.sent,
        received: a.received,
        replied: a.replied,
        replyRate: a.sent > 0 ? a.replied / a.sent : 0,
        avgResponseMin: a.respN > 0 ? Math.round(a.respMs / a.respN / 60000) : 0,
      };
    })
    .sort((a, b) => b.sent - a.sent);

  const dayKeys = buildEmptyTrend(fromIso, toIso, tz);
  const trendMap = new Map<string, { sent: number; received: number }>(
    dayKeys.map((d) => [d, { sent: 0, received: 0 }]),
  );
  for (const r of rows) {
    const key = localDayKey(r.sent_at, tz);
    const cur = trendMap.get(key);
    if (!cur) continue;
    if (r.direction === 'outbound') cur.sent += 1;
    else if (r.direction === 'inbound') cur.received += 1;
  }
  const trend: EmailTrendPoint[] = Array.from(trendMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, sent: v.sent, received: v.received }));

  return {
    fromIso,
    toIso,
    kpis: { sent, received, threadsOpen, replyRate, avgResponseMin },
    perAgent,
    trend,
  };
}

function buildEmptyTrend(fromIso: string, toIso: string, tz: string): string[] {
  const startKey = localDayKey(fromIso, tz);
  const endKey = localDayKey(toIso, tz);
  const out: string[] = [];
  for (let cursor = startKey; cursor <= endKey; cursor = addDaysToDateKey(cursor, 1)) {
    out.push(cursor);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pipeline report (Phase B) — current snapshot funnel by stage position.
// ---------------------------------------------------------------------------

export type PipelineStageRow = {
  stageId: string;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  count: number;
  pctOfTop: number;
  // Conversion to the next stage by position. Null on the last stage.
  conversion: number | null;
  // Movement within the report window, sourced from lead_events.
  entered: number;
  exited: number;
  // Average dwell time for stints that ended in the window. Null when
  // there are no completed stints to measure.
  avgDaysInStage: number | null;
};

export type PipelineReport = {
  fromIso: string;
  toIso: string;
  totalLeads: number;
  stages: PipelineStageRow[];
};

export async function loadPipelineReport(
  brandId: string,
  filterIn: ReportFilter,
): Promise<PipelineReport> {
  const filter = effectiveFilter(filterIn);
  const supabase = await createServerClient();
  const { fromIso, toIso } = rangeBounds(filter);
  // Pull a wider window of events so we can measure dwell time even when
  // a stint started before the report window. 365d is enough for SMB
  // sales cycles without being absurd.
  const historySinceIso = new Date(
    new Date(fromIso).getTime() - 365 * 86_400_000,
  ).toISOString();

  // Self-scope: filter the lead snapshot by owner_id. Stage events stay
  // brand-wide because lead_events has no member attribution column;
  // RLS already restricts agents to their own leads' events at the row
  // level so the dwell/movement math still ends up self-scoped on read.
  let leadsQ = supabase
    .from('leads')
    .select('id, stage_id')
    .eq('brand_id', brandId)
    .limit(50_000);
  if (filter.agentId) leadsQ = leadsQ.eq('owner_id', filter.agentId);

  const [{ data: stages }, { data: leadCounts }, { data: events }] = await Promise.all([
    supabase
      .from('stages')
      .select('id, name, position, is_won, is_lost')
      .eq('brand_id', brandId)
      .order('position', { ascending: true }),
    leadsQ,
    supabase
      .from('lead_events')
      .select('lead_id, payload, created_at')
      .eq('brand_id', brandId)
      .eq('type', 'stage_change')
      .gte('created_at', historySinceIso)
      .order('lead_id', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(100_000),
  ]);

  const stageList = stages ?? [];
  const leads = leadCounts ?? [];
  const totalLeads = leads.length;

  const countByStage = new Map<string, number>();
  for (const l of leads) {
    if (!l.stage_id) continue;
    countByStage.set(l.stage_id, (countByStage.get(l.stage_id) ?? 0) + 1);
  }

  // Aggregate movement + dwell from the event stream. `entered` and
  // `exited` count rows whose created_at falls in the window. Dwell is
  // attributed to a stage at the moment a lead leaves it: when consecutive
  // events show stage A → B and the B event is in the window, we add
  // (B.created_at − A.created_at) to A's dwell totals.
  const enteredByStage = new Map<string, number>();
  const exitedByStage = new Map<string, number>();
  const dwellMs = new Map<string, { sum: number; count: number }>();

  type StageEvent = {
    leadId: string;
    fromStage: string | null;
    toStage: string | null;
    at: number;
  };
  const eventRows = (events ?? []) as Array<{
    lead_id: string;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;
  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();

  let prevByLead: StageEvent | null = null;
  for (const r of eventRows) {
    const payload = r.payload ?? {};
    const fromStage =
      typeof payload.from_stage_id === 'string' ? payload.from_stage_id : null;
    const toStage =
      typeof payload.to_stage_id === 'string' ? payload.to_stage_id : null;
    const at = new Date(r.created_at).getTime();
    const cur: StageEvent = { leadId: r.lead_id, fromStage, toStage, at };

    const inWindow = at >= fromMs && at <= toMs;
    if (inWindow) {
      if (toStage) enteredByStage.set(toStage, (enteredByStage.get(toStage) ?? 0) + 1);
      if (fromStage) exitedByStage.set(fromStage, (exitedByStage.get(fromStage) ?? 0) + 1);
    }

    // Dwell: only meaningful between consecutive events for the same lead.
    if (prevByLead && prevByLead.leadId === cur.leadId && prevByLead.toStage) {
      const stintEndedAt = cur.at;
      const stintStartedAt = prevByLead.at;
      // Attribute the stint to the stage the lead was in (prev.toStage)
      // when the *exit* lands in the window.
      if (stintEndedAt >= fromMs && stintEndedAt <= toMs) {
        const stageId = prevByLead.toStage;
        const slot = dwellMs.get(stageId) ?? { sum: 0, count: 0 };
        slot.sum += stintEndedAt - stintStartedAt;
        slot.count += 1;
        dwellMs.set(stageId, slot);
      }
    }
    prevByLead = cur;
  }

  const top = stageList[0];
  const topCount = top ? countByStage.get(top.id) ?? 0 : 0;

  const rowsOut: PipelineStageRow[] = stageList.map((s, i) => {
    const count = countByStage.get(s.id) ?? 0;
    const next = stageList[i + 1];
    const nextCount = next ? countByStage.get(next.id) ?? 0 : null;
    const dwell = dwellMs.get(s.id);
    const avgDaysInStage =
      dwell && dwell.count > 0
        ? Math.round((dwell.sum / dwell.count / 86_400_000) * 10) / 10
        : null;
    return {
      stageId: s.id,
      name: s.name,
      position: s.position,
      isWon: s.is_won,
      isLost: s.is_lost,
      count,
      pctOfTop: topCount > 0 ? count / topCount : 0,
      conversion: nextCount === null ? null : count > 0 ? nextCount / count : 0,
      entered: enteredByStage.get(s.id) ?? 0,
      exited: exitedByStage.get(s.id) ?? 0,
      avgDaysInStage,
    };
  });

  return { fromIso, toIso, totalLeads, stages: rowsOut };
}

// ---------------------------------------------------------------------------
// Appointments report (Phase B)
// ---------------------------------------------------------------------------

export type AppointmentsKpis = {
  booked: number;
  showed: number;
  noShowed: number;
  cancelled: number;
  showRate: number;
};

export type AppointmentsAgentRow = {
  memberId: string;
  name: string;
  email: string;
  booked: number;
  showed: number;
  noShowed: number;
  cancelled: number;
  showRate: number;
};

export type AppointmentsTrendPoint = {
  date: string;
  booked: number;
  showed: number;
};

export type AppointmentsReport = {
  fromIso: string;
  toIso: string;
  kpis: AppointmentsKpis;
  perCloser: AppointmentsAgentRow[];
  trend: AppointmentsTrendPoint[];
};

export async function loadAppointmentsReport(
  brandId: string,
  filterIn: ReportFilter,
): Promise<AppointmentsReport> {
  const filter = effectiveFilter(filterIn);
  const supabase = await createServerClient();
  const { fromIso, toIso } = rangeBounds(filter);
  const tz = filter.timezone || 'UTC';

  let apptsQ = supabase
    .from('appointments')
    .select('id, status, member_id, starts_at')
    .eq('brand_id', brandId)
    .gte('starts_at', fromIso)
    .lte('starts_at', toIso)
    .limit(50_000);
  if (filter.agentId) apptsQ = apptsQ.eq('member_id', filter.agentId);
  const { data: appts } = await apptsQ;
  const rowsOut = appts ?? [];

  let booked = 0;
  let showed = 0;
  let noShowed = 0;
  let cancelled = 0;
  type Agg = { booked: number; showed: number; noShowed: number; cancelled: number };
  const byMember = new Map<string, Agg>();
  for (const r of rowsOut) {
    booked += 1;
    if (r.status === 'showed') showed += 1;
    else if (r.status === 'no_show') noShowed += 1;
    else if (r.status === 'cancelled') cancelled += 1;
    if (r.member_id) {
      const a = byMember.get(r.member_id) ?? { booked: 0, showed: 0, noShowed: 0, cancelled: 0 };
      a.booked += 1;
      if (r.status === 'showed') a.showed += 1;
      else if (r.status === 'no_show') a.noShowed += 1;
      else if (r.status === 'cancelled') a.cancelled += 1;
      byMember.set(r.member_id, a);
    }
  }
  const completed = showed + noShowed;
  const showRate = completed > 0 ? showed / completed : 0;

  const memberIds = Array.from(byMember.keys());
  const memberById = new Map<string, { fullName: string | null; email: string }>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, full_name, email')
      .in('id', memberIds);
    for (const m of members ?? []) memberById.set(m.id, { fullName: m.full_name, email: m.email });
  }
  const perCloser: AppointmentsAgentRow[] = Array.from(byMember.entries())
    .map(([memberId, a]) => {
      const m = memberById.get(memberId);
      const completedRows = a.showed + a.noShowed;
      return {
        memberId,
        name: m?.fullName?.trim() || m?.email || 'Unknown agent',
        email: m?.email ?? '',
        booked: a.booked,
        showed: a.showed,
        noShowed: a.noShowed,
        cancelled: a.cancelled,
        showRate: completedRows > 0 ? a.showed / completedRows : 0,
      };
    })
    .sort((a, b) => b.booked - a.booked);

  const dayKeys = buildEmptyTrend(fromIso, toIso, tz);
  const trendMap = new Map<string, { booked: number; showed: number }>(
    dayKeys.map((d) => [d, { booked: 0, showed: 0 }]),
  );
  for (const r of rowsOut) {
    const key = localDayKey(r.starts_at, tz);
    const cur = trendMap.get(key);
    if (!cur) continue;
    cur.booked += 1;
    if (r.status === 'showed') cur.showed += 1;
  }
  const trend: AppointmentsTrendPoint[] = Array.from(trendMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, booked: v.booked, showed: v.showed }));

  return {
    fromIso,
    toIso,
    kpis: { booked, showed, noShowed, cancelled, showRate },
    perCloser,
    trend,
  };
}

// ---------------------------------------------------------------------------
// SMS report (Phase B) — sourced from message_outbox.channel='sms'.
// ---------------------------------------------------------------------------

export type SmsKpis = {
  sent: number;
  delivered: number;
  failed: number;
  pending: number;
};

export type SmsTrendPoint = {
  date: string;
  sent: number;
  delivered: number;
};

export type SmsReport = {
  fromIso: string;
  toIso: string;
  kpis: SmsKpis;
  trend: SmsTrendPoint[];
};

export async function loadSmsReport(brandId: string, filterIn: ReportFilter): Promise<SmsReport> {
  const filter = effectiveFilter(filterIn);
  const supabase = await createServerClient();
  const { fromIso, toIso } = rangeBounds(filter);
  const tz = filter.timezone || 'UTC';

  // message_outbox has no member attribution column, so we can't
  // self-scope SMS volume directly. RLS already hides rows for leads
  // the agent can't see, so the count naturally narrows under an agent
  // session — we just don't add an extra .eq() here.
  const { data: outbox } = await supabase
    .from('message_outbox')
    .select('id, status, created_at')
    .eq('brand_id', brandId)
    .eq('channel', 'sms')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .limit(50_000);
  const rowsOut = outbox ?? [];

  let sent = 0;
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  for (const r of rowsOut) {
    if (r.status === 'sent' || r.status === 'delivered') sent += 1;
    if (r.status === 'delivered') delivered += 1;
    if (r.status === 'failed') failed += 1;
    if (r.status === 'pending' || r.status === 'queued') pending += 1;
  }

  const dayKeys = buildEmptyTrend(fromIso, toIso, tz);
  const trendMap = new Map<string, { sent: number; delivered: number }>(
    dayKeys.map((d) => [d, { sent: 0, delivered: 0 }]),
  );
  for (const r of rowsOut) {
    const key = localDayKey(r.created_at, tz);
    const cur = trendMap.get(key);
    if (!cur) continue;
    if (r.status === 'sent' || r.status === 'delivered') cur.sent += 1;
    if (r.status === 'delivered') cur.delivered += 1;
  }
  const trend: SmsTrendPoint[] = Array.from(trendMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, v]) => ({ date, sent: v.sent, delivered: v.delivered }));

  return {
    fromIso,
    toIso,
    kpis: { sent, delivered, failed, pending },
    trend,
  };
}

// Per-campaign breakdown: call volume, connect rate, appointments
// booked, show rate. Joined to campaigns so we can label rows even
// after a campaign is archived.
export type CampaignReportRow = {
  campaignId: string;
  name: string;
  status: string;
  calls: number;
  connects: number;
  connectRate: number;     // 0..1
  appointmentsBooked: number;
  showRate: number;        // 0..1, completed / (completed+no_show)
};

export type CampaignReport = {
  fromIso: string;
  toIso: string;
  rows: CampaignReportRow[];
  totals: {
    calls: number;
    connects: number;
    connectRate: number;
    appointmentsBooked: number;
    showRate: number;
  };
};

export async function loadCampaignReport(
  brandId: string,
  filterIn: ReportFilter,
): Promise<CampaignReport> {
  const filter = effectiveFilter(filterIn);
  const supabase = await createServerClient();
  const { fromIso, toIso } = rangeBounds(filter);

  // Pull active + archived campaigns so historical reports keep labels.
  const { data: camps } = await supabase
    .from('campaigns')
    .select('id, name, status')
    .eq('brand_id', brandId);
  const campaigns = camps ?? [];
  if (campaigns.length === 0) {
    return {
      fromIso,
      toIso,
      rows: [],
      totals: { calls: 0, connects: 0, connectRate: 0, appointmentsBooked: 0, showRate: 0 },
    };
  }

  const ids = campaigns.map((c) => c.id);

  // Self-scope: when agentId is set (either via the URL or forced by
  // viewerMemberId), restrict both calls and appointments to that
  // member so per-campaign rows show the agent's own contribution.
  let callsQ = supabase
    .from('calls')
    .select('campaign_id, disposition')
    .eq('brand_id', brandId)
    .in('campaign_id', ids)
    .gte('started_at', fromIso)
    .lte('started_at', toIso)
    .limit(100_000);
  if (filter.agentId) callsQ = callsQ.eq('member_id', filter.agentId);

  let apptsQ = supabase
    .from('appointments')
    .select('campaign_id, status')
    .eq('brand_id', brandId)
    .in('campaign_id', ids)
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .limit(100_000);
  if (filter.agentId) apptsQ = apptsQ.eq('member_id', filter.agentId);

  const [callsRes, apptsRes, categoryFor] = await Promise.all([
    callsQ,
    apptsQ,
    loadCategoryByCode(brandId),
  ]);
  // Connect = any disposition whose category is in the connected set
  // (connected, appointment_set, callback, not_interested). Stable
  // across brand-renamed labels.
  const isConnect = (code: string | null | undefined) =>
    CONNECTED_CATEGORIES.has(categoryFor(code));

  const callTotals = new Map<string, { calls: number; connects: number }>();
  for (const r of callsRes.data ?? []) {
    if (!r.campaign_id) continue;
    const cur = callTotals.get(r.campaign_id) ?? { calls: 0, connects: 0 };
    cur.calls += 1;
    if (isConnect(r.disposition)) cur.connects += 1;
    callTotals.set(r.campaign_id, cur);
  }

  const apptTotals = new Map<string, { booked: number; completed: number; noShow: number }>();
  for (const r of apptsRes.data ?? []) {
    if (!r.campaign_id) continue;
    const cur = apptTotals.get(r.campaign_id) ?? { booked: 0, completed: 0, noShow: 0 };
    cur.booked += 1;
    if (r.status === 'completed') cur.completed += 1;
    if (r.status === 'no_show') cur.noShow += 1;
    apptTotals.set(r.campaign_id, cur);
  }

  const rows: CampaignReportRow[] = campaigns
    .map((c) => {
      const calls = callTotals.get(c.id) ?? { calls: 0, connects: 0 };
      const appts = apptTotals.get(c.id) ?? { booked: 0, completed: 0, noShow: 0 };
      const denom = appts.completed + appts.noShow;
      return {
        campaignId: c.id,
        name: c.name,
        status: c.status,
        calls: calls.calls,
        connects: calls.connects,
        connectRate: calls.calls > 0 ? calls.connects / calls.calls : 0,
        appointmentsBooked: appts.booked,
        showRate: denom > 0 ? appts.completed / denom : 0,
      };
    })
    .sort((a, b) => b.calls - a.calls);

  let tCalls = 0;
  let tConnects = 0;
  let tAppts = 0;
  let tCompleted = 0;
  let tNoShow = 0;
  for (const r of callsRes.data ?? []) {
    if (!r.campaign_id) continue;
    tCalls += 1;
    if (isConnect(r.disposition)) tConnects += 1;
  }
  for (const r of apptsRes.data ?? []) {
    if (!r.campaign_id) continue;
    tAppts += 1;
    if (r.status === 'completed') tCompleted += 1;
    if (r.status === 'no_show') tNoShow += 1;
  }
  const showDenom = tCompleted + tNoShow;

  return {
    fromIso,
    toIso,
    rows,
    totals: {
      calls: tCalls,
      connects: tConnects,
      connectRate: tCalls > 0 ? tConnects / tCalls : 0,
      appointmentsBooked: tAppts,
      showRate: showDenom > 0 ? tCompleted / showDenom : 0,
    },
  };
}
