import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import { addLocalDaysIso, localStartOfWeekIso } from './datetime';
import type {
  AppointmentExtStatus,
  AppointmentStatus,
  CalendarAppointment,
} from './appointment-types';

export type {
  AppointmentExtStatus,
  AppointmentStatus,
  CalendarAppointment,
} from './appointment-types';
export { APPT_STATUSES } from './appointment-types';

// Loads every appointment that intersects [fromIso, toIso) for the brand.
// Optionally filtered to a single member. Joins the lead row for display
// labels and the member row for the assigned-setter avatar.
export async function loadCalendarAppointments(
  brandId: string,
  fromIso: string,
  toIso: string,
  memberId?: string | null,
): Promise<CalendarAppointment[]> {
  const supabase = await createServerClient();
  let query = supabase
    .from('appointments')
    .select(
      'id, starts_at, ends_at, title, status, location, notes, member_id, lead_id, calendar_id, ext_status, ext_event_id, leads(first_name, last_name, phone)',
    )
    .eq('brand_id', brandId)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true })
    .limit(500);
  if (memberId) query = query.eq('member_id', memberId);
  const { data } = await query;
  const rows = data ?? [];

  // Hydrate member display names in a single follow-up query (avoids
  // ambiguous embedded-resource selection on the calls/members FK chain).
  const memberIds = Array.from(
    new Set(rows.map((r) => r.member_id).filter((m): m is string => !!m)),
  );
  const memberById = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, full_name, email')
      .in('id', memberIds);
    for (const m of members ?? []) {
      memberById.set(m.id, m.full_name?.trim() || m.email || 'Unknown');
    }
  }

  return rows.map((a) => {
    const lead = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    const leadName = lead
      ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
      : null;
    return {
      id: a.id,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      title: a.title,
      status: a.status as AppointmentStatus,
      location: a.location,
      notes: a.notes,
      leadId: a.lead_id,
      leadName,
      leadPhone: lead?.phone ?? null,
      memberId: a.member_id,
      memberName: a.member_id ? memberById.get(a.member_id) ?? null : null,
      calendarId: a.calendar_id ?? null,
      extStatus: (a.ext_status ?? 'local') as AppointmentExtStatus,
      extEventId: a.ext_event_id ?? null,
    };
  });
}

// Returns the brand-local Monday for the given date as a UTC ISO at
// 00:00 in `tz`. Used by the calendar page to align week buckets so
// Mon..Sun always renders together regardless of the server's TZ.
export function startOfWeekIso(d: Date, tz: string): string {
  return localStartOfWeekIso(d, tz);
}

// Adds N brand-local calendar days to a UTC ISO instant, preserving
// wall-clock time. DST-safe.
export function addDaysIso(iso: string, days: number, tz: string): string {
  return addLocalDaysIso(iso, days, tz);
}

// Parses a "?week=YYYY-MM-DD" param into the brand-local Monday of that
// week. Falls back to the current week when missing or malformed. The
// date string is interpreted as a calendar date in the brand's tz.
export function parseWeekParam(value: string | undefined, tz: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Treat the date string as noon in the brand's tz so the resulting
    // Monday lookup is unambiguous on either side of a DST transition.
    const [y, m, d] = value.split('-').map(Number);
    const probeMs = Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
    if (!Number.isNaN(probeMs)) {
      return localStartOfWeekIso(new Date(probeMs), tz);
    }
  }
  return localStartOfWeekIso(undefined, tz);
}
