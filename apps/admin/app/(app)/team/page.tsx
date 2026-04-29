import { redirect } from 'next/navigation';
import { createServerClient } from '@leadpilot/db/server';
import { PageHeader } from '@/components/page-header';
import { TeamManager } from '@/components/team/team-manager';
import { getActiveBrand } from '@/lib/active-brand';
import { canSeeManagement, getCurrentBrandRole, loadTeam } from '@/lib/team';

export default async function TeamPage() {
  const active = await getActiveBrand();
  if (!active) redirect('/');

  const role = await getCurrentBrandRole(active.id);
  if (!canSeeManagement(role)) redirect('/dashboard');

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const team = await loadTeam(active.id);

  return (
    <>
      <PageHeader
        title="Team & Assignments"
        subtitle={`Members and roles for ${active.name}`}
      />
      <div className="flex-1 overflow-auto p-6">
        <TeamManager initialTeam={team} currentMemberId={user.id} />
      </div>
    </>
  );
}
