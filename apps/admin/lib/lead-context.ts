import 'server-only';
// Dialer-side lead context: a tight slice of recent activity that lets the
// rep dial a lead without alt-tabbing to /leads/[id]. Reuses loadLeadDetail
// for the canonical merge of calls + appointments + lead_events, and
// loadTasks for open follow-ups. Returns small fixed-size lists.

import { createServerClient } from '@leadpilot/db/server';
import { loadLeadDetail } from './leads';
import { loadTasks, type TaskRow } from './tasks';
import { pickCompanyFromCustom } from './company-name';

export type ContextCall = {
  id: string;
  startedAt: string;
  direction: 'inbound' | 'outbound';
  durationSec: number | null;
  disposition: string | null;
  hasRecording: boolean;
};

export type ContextAppointment = {
  id: string;
  startsAt: string;
  title: string;
  status: string;
  location: string | null;
};

export type ContextStage = {
  id: string;
  name: string;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
};

export type ContextTag = {
  id: string;
  name: string;
  color: string | null;
};

export type LeadCallContext = {
  leadId: string;
  // Editable contact fields. Surfaced to the in-call panel so the
  // rep can correct names / phone / email / company without leaving
  // the dialer. companyName resolves from leads.custom and writes
  // back through updateLeadFields.
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  city: string | null;
  state: string | null;
  doNotCall: boolean;
  doNotEmail: boolean;
  stage: ContextStage | null;
  tags: ContextTag[];
  recentCalls: ContextCall[];
  upcomingAppointments: ContextAppointment[];
  openTasks: Array<Pick<TaskRow, 'id' | 'title' | 'kind' | 'priority' | 'dueAt' | 'status'>>;
};

export async function loadLeadCallContext(
  brandId: string,
  leadId: string,
): Promise<LeadCallContext | null> {
  const supabase = await createServerClient();
  const detail = await loadLeadDetail(leadId, brandId);
  if (!detail) return null;

  // Trim to last 5 calls, ordered newest first.
  const recentCalls: ContextCall[] = detail.timeline
    .filter((e): e is Extract<typeof e, { kind: 'call' }> => e.kind === 'call')
    .slice(0, 5)
    .map((c) => ({
      id: c.id,
      startedAt: c.at,
      direction: c.direction,
      durationSec: c.durationSec,
      disposition: c.disposition,
      hasRecording: c.hasRecording,
    }));

  // Future-only appointments, soonest first.
  const now = Date.now();
  const upcomingAppointments: ContextAppointment[] = detail.timeline
    .filter((e): e is Extract<typeof e, { kind: 'appointment' }> => e.kind === 'appointment')
    .filter((a) => new Date(a.at).getTime() >= now)
    .filter((a) => a.status === 'booked' || a.status === 'confirmed')
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(0, 3)
    .map((a) => ({
      id: a.id,
      startsAt: a.at,
      title: a.title,
      status: a.status,
      location: a.location,
    }));

  // Open tasks for this lead (TaskStatus only has 'open' | 'done').
  const allTasks = await loadTasks(brandId, 'all', { leadId });
  const openTasks = allTasks
    .filter((t) => t.status === 'open')
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      title: t.title,
      kind: t.kind,
      priority: t.priority,
      dueAt: t.dueAt,
      status: t.status,
    }));

  // Stage + tags lookup. Single-row + lead-scoped tag query, both cheap.
  let stage: ContextStage | null = null;
  if (detail.lead.stageId) {
    const { data: s } = await supabase
      .from('stages')
      .select('id, name, color, is_won, is_lost')
      .eq('id', detail.lead.stageId)
      .maybeSingle();
    if (s) {
      stage = {
        id: s.id,
        name: s.name,
        color: s.color,
        isWon: s.is_won,
        isLost: s.is_lost,
      };
    }
  }

  const { data: tagRows } = await supabase
    .from('lead_tags')
    .select('tags!inner(id, name, color)')
    .eq('lead_id', leadId);
  type TagJoin = { tags: { id: string; name: string; color: string | null } | { id: string; name: string; color: string | null }[] | null };
  const tags: ContextTag[] = ((tagRows as TagJoin[] | null) ?? [])
    .map((r) => (Array.isArray(r.tags) ? r.tags[0] : r.tags))
    .filter((t): t is { id: string; name: string; color: string | null } => !!t);

  // loadLeadDetail doesn't pull leads.custom; one extra read gets us
  // the canonical company name without changing that loader's shape.
  const { data: customRow } = await supabase
    .from('leads')
    .select('custom')
    .eq('id', leadId)
    .maybeSingle();
  const companyName = customRow ? pickCompanyFromCustom(customRow.custom) : null;

  return {
    leadId,
    firstName: detail.lead.firstName,
    lastName: detail.lead.lastName,
    companyName,
    phone: detail.lead.phone,
    email: detail.lead.email,
    notes: detail.lead.notes,
    city: detail.lead.city,
    state: detail.lead.state,
    doNotCall: detail.lead.doNotCall,
    doNotEmail: detail.lead.doNotEmail,
    stage,
    tags,
    recentCalls,
    upcomingAppointments,
    openTasks,
  };
}
