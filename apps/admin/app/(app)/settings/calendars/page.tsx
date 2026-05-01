import { redirect } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import { canManageTeam, getCurrentBrandRole } from '@/lib/team';
import { loadBrandCalendars } from '@/lib/calendars';
import { loadTeam } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { CalendarsManager } from '@/components/settings/calendars-manager';

export default async function CalendarsPage() {
  const active = await getActiveBrand();
  if (!active) return null;
  const role = await getCurrentBrandRole(active.id);
  if (!canManageTeam(role)) redirect('/settings');

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
