import { getActiveBrand } from '@/lib/active-brand';
import { assertBrandRoleOrNotFound } from '@/lib/team';
import { loadBrandCalendars } from '@/lib/calendars';
import { loadTeam } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { CalendarsManager } from '@/components/settings/calendars-manager';

export default async function CalendarsPage() {
  // Calendar config is manager+. Was previously gated to admin/owner via
  // canManageTeam — same bug we fixed in actions/calendars.ts.
  await assertBrandRoleOrNotFound('manager');
  const active = await getActiveBrand();
  if (!active) return null;

  const [calendars, team] = await Promise.all([
    loadBrandCalendars(active.id),
    loadTeam(active.id),
  ]);

  return (
    <>
      <PageHeader
        title="Calendars"
        subtitle={`${active.name} · brand-owned shared calendars`}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <CalendarsManager initialCalendars={calendars} team={team} />
        </div>
      </div>
    </>
  );
}
