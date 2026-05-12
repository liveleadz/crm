import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import { loadDispositions, type Disposition } from './dispositions';
import { pickCompanyFromCustom } from './company-name';
import type { MemberRole } from './team';

export type Kpis = {
  activeLeads: number;
  todaysAppointments: number;
  noShowsThisWeek: number;
  callsThisWeek: number;
};

export type PipelineSlice = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  isWon: boolean;
  isLost: boolean;
  isAppointmentSet: boolean;
  isNoShow: boolean;
  count: number;
};

export type RecentCall = {
  id: string;
  startedAt: string;
  durationSec: number | null;
  direction: 'inbound' | 'outbound';
  disposition: string | null;
  leadName: string | null;
  hasRecording: boolean;
};

export type TodayAppointment = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  title: string;
  status: string;
  location: string | null;
  leadName: string | null;
};

export type TodayOutcome = {
  code: string;
  label: string;
  tone: 'good' | 'neutral' | 'bad';
  count: number;
};

export type RecentImport = {
  id: string;
  name: string;
  createdAt: string;
  count: number;
};

export type TopTag = {
  id: string;
  name: string;
  color: string | null;
  count: number;
};

function startOfTodayIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function startOfTomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
function sevenDaysAgoIso() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
}

export async function loadDashboard(
  brandId: string,
  opts?: { viewerMemberId?: string | null; role?: MemberRole | null },
) {
  const supabase = await createServerClient();
  const todayStart = startOfTodayIso();
  const tomorrowStart = startOfTomorrowIso();
  const weekAgo = sevenDaysAgoIso();
  // Self-scope filter for agents/viewers. When set, every aggregate that
  // has a member-or-owner attribution column is narrowed to that member,
  // so the agent's KPIs and lists reflect their own work — not the
  // brand-wide totals managers see. Brand-wide config (stages, tags,
  // dispositions) is left brand-scoped.
  const selfMemberId = opts?.viewerMemberId ?? null;

  // Helper closures keep the Promise.all readable: each builder appends
  // the self-scope filter when applicable. Without these, the whole
  // .all block would be a wall of conditional .eq() chains.
  const scopeLeads = <T extends { eq: (col: string, val: string) => T }>(q: T): T =>
    selfMemberId ? q.eq('owner_id', selfMemberId) : q;
  const scopeCalls = <T extends { eq: (col: string, val: string) => T }>(q: T): T =>
    selfMemberId ? q.eq('member_id', selfMemberId) : q;
  const scopeAppts = scopeCalls;

  const [
    activeLeadsRes,
    todaysApptsRes,
    noShowsRes,
    callsThisWeekRes,
    stagesRes,
    leadsByStageRes,
    recentCallsRes,
    todayApptsListRes,
    todayOutcomesRes,
    recentImportsRes,
    tagRowsRes,
    tagLibraryRes,
    dispositions,
  ] = await Promise.all([
    scopeLeads(
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId),
    ),
    scopeAppts(
      supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('starts_at', todayStart)
        .lt('starts_at', tomorrowStart),
    ),
    scopeAppts(
      supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('status', 'no_show')
        .gte('starts_at', weekAgo),
    ),
    scopeCalls(
      supabase
        .from('calls')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .gte('started_at', weekAgo),
    ),
    supabase
      .from('stages')
      .select('id, name, color, position, is_won, is_lost, is_appointment_set, is_no_show')
      .eq('brand_id', brandId)
      .order('position'),
    scopeLeads(
      supabase
        .from('leads')
        .select('stage_id')
        .eq('brand_id', brandId),
    ),
    scopeCalls(
      supabase
        .from('calls')
        .select('id, started_at, duration_sec, direction, disposition, recording_url, leads(first_name, last_name, custom)')
        .eq('brand_id', brandId)
        .order('started_at', { ascending: false })
        .limit(5),
    ),
    scopeAppts(
      supabase
        .from('appointments')
        .select('id, starts_at, ends_at, title, status, location, leads(first_name, last_name, custom)')
        .eq('brand_id', brandId)
        .gte('starts_at', todayStart)
        .lt('starts_at', tomorrowStart)
        .order('starts_at')
        .limit(8),
    ),
    // Calls started today, restricted to those with a disposition set.
    // We aggregate client-side because the SQL view for grouped counts
    // doesn't exist yet and the daily volume is well under any
    // reasonable in-process aggregate budget.
    scopeCalls(
      supabase
        .from('calls')
        .select('disposition')
        .eq('brand_id', brandId)
        .gte('started_at', todayStart)
        .not('disposition', 'is', null),
    ),
    // Imports — last 5 import-source lists. Counts come from a separate
    // lookup against leads.list_id below (matches the loadLists pattern
    // and survives RLS without an extra join). Lists are brand config
    // (no member attribution column), so we leave them brand-wide even
    // for self-scoped viewers — agents see what's available to import
    // from, just as they would on the lists page.
    supabase
      .from('lead_lists')
      .select('id, name, created_at')
      .eq('brand_id', brandId)
      .eq('source', 'import')
      .order('created_at', { ascending: false })
      .limit(5),
    // All lead_tags joins for this brand's leads; aggregated below. For
    // self-scoped viewers, restrict via the underlying lead's owner_id
    // so the agent's "Top tags" reflects only their own pipeline.
    selfMemberId
      ? supabase
          .from('lead_tags')
          .select('tag_id, leads!inner(brand_id, owner_id)')
          .eq('leads.brand_id', brandId)
          .eq('leads.owner_id', selfMemberId)
      : supabase
          .from('lead_tags')
          .select('tag_id, leads!inner(brand_id)')
          .eq('leads.brand_id', brandId),
    supabase
      .from('tags')
      .select('id, name, color')
      .eq('brand_id', brandId),
    loadDispositions(brandId),
  ]);

  const stages = stagesRes.data ?? [];
  const counts = new Map<string, number>();
  for (const row of leadsByStageRes.data ?? []) {
    if (row.stage_id) counts.set(row.stage_id, (counts.get(row.stage_id) ?? 0) + 1);
  }
  const allPipeline: PipelineSlice[] = stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: s.is_won,
    isLost: s.is_lost,
    isAppointmentSet: s.is_appointment_set,
    isNoShow: s.is_no_show,
    count: counts.get(s.id) ?? 0,
  }));
  // Above-agent roles only see the closing handoff stages on the dashboard
  // pipeline card, mirroring the kanban scoping in lib/leads.ts.
  const closerOnly = opts?.role === 'manager' || opts?.role === 'admin' || opts?.role === 'owner';
  const pipeline: PipelineSlice[] = closerOnly
    ? allPipeline.filter((p) => p.isAppointmentSet || p.isNoShow || p.isWon)
    : allPipeline;

  const activeLeads =
    (activeLeadsRes.count ?? 0) -
    allPipeline.filter((p) => p.isWon || p.isLost).reduce((acc, p) => acc + p.count, 0);

  const kpis: Kpis = {
    activeLeads: Math.max(activeLeads, 0),
    todaysAppointments: todaysApptsRes.count ?? 0,
    noShowsThisWeek: noShowsRes.count ?? 0,
    callsThisWeek: callsThisWeekRes.count ?? 0,
  };

  const recentCalls: RecentCall[] = (recentCallsRes.data ?? []).map((c) => {
    const lead = Array.isArray(c.leads) ? c.leads[0] : c.leads;
    // Person name → business name (from leads.custom) → null. Without
    // the company fallback, the dashboard's recent-calls feed read as
    // "Unknown lead" for every B2B import that ships only a company.
    const personName = lead
      ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim()
      : '';
    const companyName = lead ? pickCompanyFromCustom(lead.custom) : null;
    return {
      id: c.id,
      startedAt: c.started_at,
      durationSec: c.duration_sec,
      direction: c.direction,
      disposition: c.disposition,
      leadName: personName || companyName || null,
      hasRecording: Boolean(c.recording_url),
    };
  });

  const todayAppointments: TodayAppointment[] = (todayApptsListRes.data ?? []).map((a) => {
    const lead = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    const personName = lead
      ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim()
      : '';
    const companyName = lead ? pickCompanyFromCustom(lead.custom) : null;
    const name = personName || companyName || null;
    return {
      id: a.id,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      title: a.title,
      status: a.status,
      location: a.location,
      leadName: name || null,
    };
  });

  // Today's call outcomes — aggregate disposition counts and project
  // through the brand's disposition catalog so labels + tone come from
  // the same source as the dispositions UI. Codes that exist on a call
  // but not in the catalog (archived dispositions) still show with the
  // raw code as label and 'neutral' tone.
  const dispByCode = new Map<string, Disposition>();
  for (const d of (dispositions as Disposition[]) ?? []) dispByCode.set(d.code, d);
  const outcomeCounts = new Map<string, number>();
  for (const row of todayOutcomesRes.data ?? []) {
    if (!row.disposition) continue;
    outcomeCounts.set(row.disposition, (outcomeCounts.get(row.disposition) ?? 0) + 1);
  }
  const todayOutcomes: TodayOutcome[] = Array.from(outcomeCounts.entries())
    .map(([code, count]) => {
      const meta = dispByCode.get(code);
      return {
        code,
        label: meta?.label ?? code,
        tone: meta?.tone ?? 'neutral',
        count,
      };
    })
    .sort((a, b) => b.count - a.count);

  // Recent imports — pair each lead_list with its current lead count.
  // We do one targeted query per import (limited to 5) because the
  // global list_id roll-up over a brand's entire leads table can be
  // large; per-list count(*) with head:true is cheap.
  const importsRaw = recentImportsRes.data ?? [];
  const importCounts = await Promise.all(
    importsRaw.map((l) => {
      let q = supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .eq('list_id', l.id);
      if (selfMemberId) q = q.eq('owner_id', selfMemberId);
      return q.then((r) => r.count ?? 0);
    }),
  );
  const recentImports: RecentImport[] = importsRaw.map((l, i) => ({
    id: l.id,
    name: l.name,
    createdAt: l.created_at,
    count: importCounts[i] ?? 0,
  }));

  // Top tags — count lead_tags joins, hydrate names/colors from the
  // tag library, take top 5 by count. Tags with zero leads attached are
  // omitted entirely.
  const tagCounts = new Map<string, number>();
  for (const row of tagRowsRes.data ?? []) {
    tagCounts.set(row.tag_id, (tagCounts.get(row.tag_id) ?? 0) + 1);
  }
  const topTags: TopTag[] = (tagLibraryRes.data ?? [])
    .map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      count: tagCounts.get(t.id) ?? 0,
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    kpis,
    pipeline,
    recentCalls,
    todayAppointments,
    todayOutcomes,
    recentImports,
    topTags,
  };
}
