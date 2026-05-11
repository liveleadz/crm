import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import { loadTagsForLeads, type Tag } from './tags';
import { pickCompanyFromCustom } from './company-name';
import type { MemberRole } from './team';

export type LeadStage = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  isWon: boolean;
  isLost: boolean;
  isAppointmentSet: boolean;
  isNoShow: boolean;
};

// Above-agent roles only see the closing handoff: Appointment Set / No Show /
// Won. Agents keep the full pipeline. Pure view scoping — RLS is unchanged so
// direct lead URLs and imports keep working for above-agent roles.
function isCloserOnly(role: MemberRole | null | undefined): boolean {
  return role === 'manager' || role === 'admin' || role === 'owner';
}

function filterStagesForRole(
  stages: LeadStage[],
  role: MemberRole | null | undefined,
): LeadStage[] {
  if (!isCloserOnly(role)) return stages;
  return stages.filter((s) => s.isAppointmentSet || s.isNoShow || s.isWon);
}

export type LeadCard = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  // Pulled from leads.custom JSONB so the table/kanban can fall back to
  // company name when the lead has no person name. Same key resolution
  // as the dialer queue.
  companyName: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  stageId: string | null;
  updatedAt: string;
  doNotCall: boolean;
  doNotEmail: boolean;
  tags: Tag[];
};

export type KanbanFilter = {
  listId?: string | null;
  search?: string | null;
  source?: string | null;
  // Match leads that have ANY of these tag ids attached.
  tagIds?: string[] | null;
  // When true, exclude leads with the corresponding consent flag set.
  excludeDnc?: boolean;
  excludeDne?: boolean;
};

export type LeadDetail = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  stageId: string | null;
  ownerId: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  doNotCall: boolean;
  doNotEmail: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TimelineEntry =
  | {
      kind: 'call';
      id: string;
      at: string;
      direction: 'inbound' | 'outbound';
      disposition: string | null;
      durationSec: number | null;
      hasRecording: boolean;
      recordingDurationSec: number | null;
    }
  | {
      kind: 'appointment';
      id: string;
      at: string;
      title: string;
      status: string;
      location: string | null;
    }
  | {
      kind: 'event';
      id: string;
      at: string;
      type: string;
      payload: Record<string, unknown>;
    };

export async function loadLeadDetail(leadId: string, brandId: string) {
  const supabase = await createServerClient();
  const [leadRes, callsRes, apptsRes, eventsRes] = await Promise.all([
    supabase
      .from('leads')
      .select(
        'id, first_name, last_name, phone, email, source, stage_id, owner_id, city, state, zip, notes, do_not_call, do_not_email, created_at, updated_at',
      )
      .eq('id', leadId)
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase
      .from('calls')
      .select(
        'id, started_at, direction, disposition, duration_sec, recording_url, recording_duration_sec',
      )
      .eq('lead_id', leadId)
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('appointments')
      .select('id, starts_at, title, status, location')
      .eq('lead_id', leadId)
      .order('starts_at', { ascending: false })
      .limit(50),
    supabase
      .from('lead_events')
      .select('id, created_at, type, payload')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (!leadRes.data) return null;
  const l = leadRes.data;
  const lead: LeadDetail = {
    id: l.id,
    firstName: l.first_name,
    lastName: l.last_name,
    phone: l.phone,
    email: l.email,
    source: l.source,
    stageId: l.stage_id,
    ownerId: l.owner_id ?? null,
    city: l.city,
    state: l.state,
    zip: l.zip,
    notes: l.notes,
    doNotCall: l.do_not_call,
    doNotEmail: l.do_not_email,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
  };

  const timeline: TimelineEntry[] = [
    ...(callsRes.data ?? []).map<TimelineEntry>((c) => ({
      kind: 'call',
      id: c.id,
      at: c.started_at,
      direction: c.direction as 'inbound' | 'outbound',
      disposition: c.disposition,
      durationSec: c.duration_sec,
      hasRecording: Boolean(c.recording_url),
      recordingDurationSec: c.recording_duration_sec ?? null,
    })),
    ...(apptsRes.data ?? []).map<TimelineEntry>((a) => ({
      kind: 'appointment',
      id: a.id,
      at: a.starts_at,
      title: a.title,
      status: a.status,
      location: a.location,
    })),
    ...(eventsRes.data ?? []).map<TimelineEntry>((e) => ({
      kind: 'event',
      id: e.id,
      at: e.created_at,
      type: e.type,
      payload: (e.payload as Record<string, unknown>) ?? {},
    })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return { lead, timeline };
}

// Stage-only loader for pages that just need the pipeline shape (e.g. the
// import wizard). Skips the (potentially expensive) leads + tag join that
// loadKanban performs, so it stays fast even on brands with thousands of
// leads.
export async function loadStages(
  brandId: string,
  role?: MemberRole | null,
): Promise<LeadStage[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('stages')
    .select('id, name, color, position, is_won, is_lost, is_appointment_set, is_no_show')
    .eq('brand_id', brandId)
    .order('position');
  const stages: LeadStage[] = (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: s.is_won,
    isLost: s.is_lost,
    isAppointmentSet: s.is_appointment_set,
    isNoShow: s.is_no_show,
  }));
  return filterStagesForRole(stages, role);
}

export async function loadKanban(
  brandId: string,
  filter: KanbanFilter = {},
  role?: MemberRole | null,
) {
  const supabase = await createServerClient();

  // Stages first so closer-only roles can apply the stage scope at the DB
  // level — otherwise the count(exact) below would diverge from the rows.
  const { data: stagesData } = await supabase
    .from('stages')
    .select('id, name, color, position, is_won, is_lost, is_appointment_set, is_no_show')
    .eq('brand_id', brandId)
    .order('position');

  const allStages: LeadStage[] = (stagesData ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: s.is_won,
    isLost: s.is_lost,
    isAppointmentSet: s.is_appointment_set,
    isNoShow: s.is_no_show,
  }));
  const stages = filterStagesForRole(allStages, role);
  const visibleStageIds = isCloserOnly(role) ? stages.map((s) => s.id) : null;

  // Tag filter requires a join. Pre-query lead_tags for matching ids.
  let tagFilteredIds: string[] | null = null;
  if (filter.tagIds && filter.tagIds.length > 0) {
    const { data: ltRows } = await supabase
      .from('lead_tags')
      .select('lead_id')
      .in('tag_id', filter.tagIds);
    tagFilteredIds = Array.from(new Set((ltRows ?? []).map((r) => r.lead_id)));
  }

  const search = filter.search?.trim();
  let searchOr: string | null = null;
  if (search) {
    const esc = search.replace(/[%,]/g, ' ');
    const pattern = `%${esc}%`;
    searchOr = `first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`;
  }

  // Sentinel UUID forces an empty result when the filter implies no possible
  // matches (closer with no visible stages, or tag filter with no leads).
  const EMPTY = '00000000-0000-0000-0000-000000000000';
  const forceEmpty =
    (visibleStageIds !== null && visibleStageIds.length === 0) ||
    (tagFilteredIds !== null && tagFilteredIds.length === 0);

  // Build leads (rows) and count(exact, head) queries with identical filters
  // so the subtitle total matches the actual list size, independent of
  // PostgREST's implicit 1000-row cap on the rows query.
  let leadsQuery = supabase
    .from('leads')
    .select(
      'id, first_name, last_name, phone, email, source, stage_id, updated_at, do_not_call, do_not_email, custom',
    )
    .eq('brand_id', brandId)
    .order('updated_at', { ascending: false });
  let countQuery = supabase
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId);

  if (forceEmpty) {
    leadsQuery = leadsQuery.eq('id', EMPTY);
    countQuery = countQuery.eq('id', EMPTY);
  } else {
    if (filter.listId) {
      leadsQuery = leadsQuery.eq('list_id', filter.listId);
      countQuery = countQuery.eq('list_id', filter.listId);
    }
    if (filter.source) {
      const src = filter.source as 'manual' | 'form' | 'csv' | 'api' | 'workflow';
      leadsQuery = leadsQuery.eq('source', src);
      countQuery = countQuery.eq('source', src);
    }
    if (filter.excludeDnc) {
      leadsQuery = leadsQuery.eq('do_not_call', false);
      countQuery = countQuery.eq('do_not_call', false);
    }
    if (filter.excludeDne) {
      leadsQuery = leadsQuery.eq('do_not_email', false);
      countQuery = countQuery.eq('do_not_email', false);
    }
    if (searchOr) {
      leadsQuery = leadsQuery.or(searchOr);
      countQuery = countQuery.or(searchOr);
    }
    if (tagFilteredIds && tagFilteredIds.length > 0) {
      leadsQuery = leadsQuery.in('id', tagFilteredIds);
      countQuery = countQuery.in('id', tagFilteredIds);
    }
    if (visibleStageIds && visibleStageIds.length > 0) {
      leadsQuery = leadsQuery.in('stage_id', visibleStageIds);
      countQuery = countQuery.in('stage_id', visibleStageIds);
    }
  }

  const [leadsRes, countRes] = await Promise.all([leadsQuery, countQuery]);

  const rows = leadsRes.data ?? [];
  const total = countRes.count ?? rows.length;
  const tagMap = await loadTagsForLeads(rows.map((l) => l.id));
  const leads: LeadCard[] = rows.map((l) => ({
    id: l.id,
    firstName: l.first_name,
    lastName: l.last_name,
    companyName: pickCompanyFromCustom(l.custom),
    phone: l.phone,
    email: l.email,
    source: l.source,
    stageId: l.stage_id,
    updatedAt: l.updated_at,
    doNotCall: l.do_not_call,
    doNotEmail: l.do_not_email,
    tags: tagMap.get(l.id) ?? [],
  }));

  return { stages, leads, total };
}
