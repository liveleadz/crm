import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

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
  count: number;
};

export type RecentCall = {
  id: string;
  startedAt: string;
  durationSec: number | null;
  direction: 'inbound' | 'outbound';
  disposition: string | null;
  leadName: string | null;
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

export async function loadDashboard(brandId: string) {
  const supabase = await createServerClient();
  const todayStart = startOfTodayIso();
  const tomorrowStart = startOfTomorrowIso();
  const weekAgo = sevenDaysAgoIso();

  const [
    activeLeadsRes,
    todaysApptsRes,
    noShowsRes,
    callsThisWeekRes,
    stagesRes,
    leadsByStageRes,
    recentCallsRes,
    todayApptsListRes,
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('starts_at', todayStart)
      .lt('starts_at', tomorrowStart),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'no_show')
      .gte('starts_at', weekAgo),
    supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .gte('started_at', weekAgo),
    supabase
      .from('stages')
      .select('id, name, color, position, is_won, is_lost')
      .eq('brand_id', brandId)
      .order('position'),
    supabase
      .from('leads')
      .select('stage_id')
      .eq('brand_id', brandId),
    supabase
      .from('calls')
      .select('id, started_at, duration_sec, direction, disposition, leads(first_name, last_name)')
      .eq('brand_id', brandId)
      .order('started_at', { ascending: false })
      .limit(5),
    supabase
      .from('appointments')
      .select('id, starts_at, ends_at, title, status, location, leads(first_name, last_name)')
      .eq('brand_id', brandId)
      .gte('starts_at', todayStart)
      .lt('starts_at', tomorrowStart)
      .order('starts_at')
      .limit(8),
  ]);

  const stages = stagesRes.data ?? [];
  const counts = new Map<string, number>();
  for (const row of leadsByStageRes.data ?? []) {
    if (row.stage_id) counts.set(row.stage_id, (counts.get(row.stage_id) ?? 0) + 1);
  }
  const pipeline: PipelineSlice[] = stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: s.is_won,
    isLost: s.is_lost,
    count: counts.get(s.id) ?? 0,
  }));

  const activeLeads =
    (activeLeadsRes.count ?? 0) -
    pipeline.filter((p) => p.isWon || p.isLost).reduce((acc, p) => acc + p.count, 0);

  const kpis: Kpis = {
    activeLeads: Math.max(activeLeads, 0),
    todaysAppointments: todaysApptsRes.count ?? 0,
    noShowsThisWeek: noShowsRes.count ?? 0,
    callsThisWeek: callsThisWeekRes.count ?? 0,
  };

  const recentCalls: RecentCall[] = (recentCallsRes.data ?? []).map((c) => {
    const lead = Array.isArray(c.leads) ? c.leads[0] : c.leads;
    const name = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() : null;
    return {
      id: c.id,
      startedAt: c.started_at,
      durationSec: c.duration_sec,
      direction: c.direction,
      disposition: c.disposition,
      leadName: name || null,
    };
  });

  const todayAppointments: TodayAppointment[] = (todayApptsListRes.data ?? []).map((a) => {
    const lead = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    const name = lead ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() : null;
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

  return { kpis, pipeline, recentCalls, todayAppointments };
}
