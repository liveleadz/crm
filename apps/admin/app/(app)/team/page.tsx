import { redirect } from 'next/navigation';
import { createServerClient } from '@leadpilot/db/server';
import { PageHeader } from '@/components/page-header';
import { RangeFilter } from '@/components/team/range-filter';
import { TeamLeaderboard } from '@/components/team/team-leaderboard';
import { TeamManager } from '@/components/team/team-manager';
import { getActiveBrand } from '@/lib/active-brand';
import type { RollingRange } from '@/lib/datetime';
import { canSeeManagement, getCurrentBrandRole, loadTeam } from '@/lib/team';
import { loadTeamLeaderboard } from '@/lib/team-leaderboard';

type SearchParams = Promise<{
  range?: string;
  from?: string;
  to?: string;
}>;

const VALID: RollingRange[] = ['1d', '7d', '30d', '90d', 'custom'];

export default async function TeamPage({ searchParams }: { searchParams: SearchParams }) {
  const active = await getActiveBrand();
  if (!active) redirect('/');

  const role = await getCurrentBrandRole(active.id);
  if (!canSeeManagement(role)) redirect('/dashboard');

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const sp = await searchParams;
  const range: RollingRange = VALID.includes(sp.range as RollingRange)
    ? (sp.range as RollingRange)
    : '7d';
  const fromIso = parseDateInput(sp.from, 'start');
  const toIso = parseDateInput(sp.to, 'end');

  const [team, leaderboard] = await Promise.all([
    loadTeam(active.id),
    loadTeamLeaderboard(active.id, active.timezone, { range, fromIso, toIso }),
  ]);

  return (
    <>
      <PageHeader
        title="Team & Assignments"
        subtitle={`Members and roles for ${active.name}`}
      />
      <div className="flex-1 space-y-6 overflow-auto p-6">
        <RangeFilter
          current={range}
          fromIso={leaderboard.fromIso}
          toIso={leaderboard.toIso}
        />
        <TeamLeaderboard data={leaderboard} />
        <TeamManager initialTeam={team} currentMemberId={user.id} />
      </div>
    </>
  );
}

function parseDateInput(input: string | undefined, edge: 'start' | 'end'): string | null {
  if (!input) return null;
  const [y, m, d] = input.split('-').map(Number);
  if (!y || !m || !d) return null;
  const stamp =
    edge === 'start'
      ? new Date(y, m - 1, d, 0, 0, 0)
      : new Date(y, m - 1, d, 23, 59, 59);
  return stamp.toISOString();
}
