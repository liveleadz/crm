import { getActiveBrand } from '@/lib/active-brand';
import {
  addDaysIso,
  loadCalendarAppointments,
  parseWeekParam,
} from '@/lib/appointments';
import { loadTeam } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { WeekView } from '@/components/calendar/week-view';
import { RealtimeRefresher } from '@/components/realtime-refresher';

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; member?: string }>;
}) {
  const active = await getActiveBrand();
  if (!active) return null;
  const sp = await searchParams;
  const weekStartIso = parseWeekParam(sp.week, active.timezone);
  const weekEndIso = addDaysIso(weekStartIso, 7, active.timezone);
  const memberFilter = sp.member?.trim() || null;

  const [appointments, team] = await Promise.all([
    loadCalendarAppointments(active.id, weekStartIso, weekEndIso, memberFilter),
    loadTeam(active.id),
  ]);

  const teamOpts = team
    .filter((t) => t.isActive)
    .map((t) => ({ id: t.memberId, name: t.fullName?.trim() || t.email }));

  const subtitle = `${appointments.length} appointment${appointments.length === 1 ? '' : 's'} this week`;

  return (
    <>
      <PageHeader title="Calendar" subtitle={subtitle} />
      <RealtimeRefresher channel="calendar-week" tables={['appointments']} />
      <WeekView
        weekStartIso={weekStartIso}
        appointments={appointments}
        team={teamOpts}
        agentFilterId={memberFilter}
        agentOptions={teamOpts}
        timezone={active.timezone}
      />
    </>
  );
}
