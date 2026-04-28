import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

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
  phone: string | null;
  email: string | null;
  source: string;
  stageId: string | null;
  updatedAt: string;
};

export type LeadDetail = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  stageId: string | null;
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
        'id, first_name, last_name, phone, email, source, stage_id, city, state, zip, notes, do_not_call, do_not_email, created_at, updated_at',
      )
      .eq('id', leadId)
      .eq('brand_id', brandId)
      .maybeSingle(),
    supabase
      .from('calls')
      .select('id, started_at, direction, disposition, duration_sec')
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

export async function loadKanban(brandId: string) {
  const supabase = await createServerClient();
  const [stagesRes, leadsRes] = await Promise.all([
    supabase
      .from('stages')
      .select('id, name, color, position, is_won, is_lost')
      .eq('brand_id', brandId)
      .order('position'),
    supabase
      .from('leads')
      .select('id, first_name, last_name, phone, email, source, stage_id, updated_at')
      .eq('brand_id', brandId)
      .order('updated_at', { ascending: false }),
  ]);

  const stages: LeadStage[] = (stagesRes.data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: s.is_won,
    isLost: s.is_lost,
  }));

  const leads: LeadCard[] = (leadsRes.data ?? []).map((l) => ({
    id: l.id,
    firstName: l.first_name,
    lastName: l.last_name,
    phone: l.phone,
    email: l.email,
    source: l.source,
    stageId: l.stage_id,
    updatedAt: l.updated_at,
  }));

  return { stages, leads };
}
