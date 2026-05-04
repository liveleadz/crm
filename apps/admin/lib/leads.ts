import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import { loadTagsForLeads, type Tag } from './tags';
import { pickCompanyFromCustom } from './company-name';

export type LeadStage = {
  id: string;
  name: string;
  color: string | null;
  position: number;
  isWon: boolean;
  isLost: boolean;
};

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
export async function loadStages(brandId: string): Promise<LeadStage[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('stages')
    .select('id, name, color, position, is_won, is_lost')
    .eq('brand_id', brandId)
    .order('position');
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: s.is_won,
    isLost: s.is_lost,
  }));
}

export async function loadKanban(brandId: string, filter: KanbanFilter = {}) {
  const supabase = await createServerClient();
  let leadsQuery = supabase
    .from('leads')
    .select(
      'id, first_name, last_name, phone, email, source, stage_id, updated_at, do_not_call, do_not_email, custom',
    )
    .eq('brand_id', brandId)
    .order('updated_at', { ascending: false });
  if (filter.listId) leadsQuery = leadsQuery.eq('list_id', filter.listId);
  if (filter.source)
    leadsQuery = leadsQuery.eq(
      'source',
      filter.source as 'manual' | 'form' | 'csv' | 'api' | 'workflow',
    );
  if (filter.excludeDnc) leadsQuery = leadsQuery.eq('do_not_call', false);
  if (filter.excludeDne) leadsQuery = leadsQuery.eq('do_not_email', false);

  // Free-text search across name/phone/email.
  const search = filter.search?.trim();
  if (search) {
    const esc = search.replace(/[%,]/g, ' ');
    const pattern = `%${esc}%`;
    leadsQuery = leadsQuery.or(
      `first_name.ilike.${pattern},last_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`,
    );
  }

  // Tag filter requires a join. We pre-query lead_tags to find matching ids,
  // then add an .in() clause. Empty result short-circuits to no leads.
  let tagFilteredIds: string[] | null = null;
  if (filter.tagIds && filter.tagIds.length > 0) {
    const { data: ltRows } = await supabase
      .from('lead_tags')
      .select('lead_id')
      .in('tag_id', filter.tagIds);
    tagFilteredIds = Array.from(new Set((ltRows ?? []).map((r) => r.lead_id)));
    if (tagFilteredIds.length === 0) {
      // Force empty leads result while still loading stages for the kanban shell.
      leadsQuery = leadsQuery.eq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      leadsQuery = leadsQuery.in('id', tagFilteredIds);
    }
  }

  const [stagesRes, leadsRes] = await Promise.all([
    supabase
      .from('stages')
      .select('id, name, color, position, is_won, is_lost')
      .eq('brand_id', brandId)
      .order('position'),
    leadsQuery,
  ]);

  const stages: LeadStage[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: s.is_won,
    isLost: s.is_lost,
  }));

  const rows = leadsRes.data ?? [];
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

  return { stages, leads };
}
