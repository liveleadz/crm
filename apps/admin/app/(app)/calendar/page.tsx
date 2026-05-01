import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import {
  addDaysIso,
  loadCalendarAppointments,
  parseWeekParam,
} from '@/lib/appointments';
import {
  canSeeManagement,
  getCurrentBrandRole,
  loadTeam,
} from '@/lib/team';
import {
  loadAssignedCalendars,
  loadBrandCalendars,
  type CalendarRow,
} from '@/lib/calendars';
import { PageHeader } from '@/components/page-header';
import { WeekView } from '@/components/calendar/week-view';
import { RealtimeRefresher } from '@/components/realtime-refresher';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; member?: string; calendar?: string }>;
}) {
  const active = await getActiveBrand();
  if (!active) return null;
  const sp = await searchParams;
  const weekStartIso = parseWeekParam(sp.week, active.timezone);
  const weekEndIso = addDaysIso(weekStartIso, 7, active.timezone);
  const memberFilter = sp.member?.trim() || null;
  const calendarFilter = sp.calendar?.trim() || null;

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const role = await getCurrentBrandRole(active.id);

  const [appointments, team, calendars] = await Promise.all([
    loadCalendarAppointments(active.id, weekStartIso, weekEndIso, memberFilter),
    loadTeam(active.id),
    canSeeManagement(role)
      ? loadBrandCalendars(active.id)
      : user
        ? loadAssignedCalendars(active.id, user.id)
        : Promise.resolve<CalendarRow[]>([]),
  ]);

  const filteredAppointments = calendarFilter
    ? appointments.filter((a) => a.calendarId === calendarFilter)
    : appointments;

  const teamOpts = team
    .filter((t) => t.isActive)
    .map((t) => ({ id: t.memberId, name: t.fullName?.trim() || t.email }));

  const calendarOpts = calendars.map((c) => ({
    id: c.id,
    name: c.name,
    color: c.color,
    ownerMemberId: c.ownerMemberId,
  }));

  const subtitle = `${filteredAppointments.length} appointment${filteredAppointments.length === 1 ? '' : 's'} this week`;

  return (
    <>
      <PageHeader title="Calendar" subtitle={subtitle} />
      <RealtimeRefresher channel="calendar-week" tables={['appointments']} />
      <WeekView
        weekStartIso={weekStartIso}
        appointments={filteredAppointments}
        team={teamOpts}
        agentFilterId={memberFilter}
        agentOptions={teamOpts}
        calendars={calendarOpts}
        calendarFilterId={calendarFilter}
        timezone={active.timezone}
      />
    </>
  );
}
