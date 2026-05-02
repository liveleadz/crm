import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { RangeFilter } from '@/components/team/range-filter';
import { Scorecard } from '@/components/team/scorecard';
import { getActiveBrand } from '@/lib/active-brand';
import type { RollingRange } from '@/lib/datetime';
import { canSeeManagement, getCurrentBrandRole } from '@/lib/team';
import { loadScorecard } from '@/lib/scorecard';

type SearchParams = Promise<{
  range?: string;
  from?: string;
  to?: string;
}>;

const VALID: RollingRange[] = ['1d', '7d', '30d', '90d', 'custom'];

export default async function MemberScorecardPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: SearchParams;
}) {
  const active = await getActiveBrand();
  if (!active) redirect('/');
  const role = await getCurrentBrandRole(active.id);
  if (!canSeeManagement(role)) redirect('/dashboard');

  const { memberId } = await params;
  const sp = await searchParams;
  const range: RollingRange = VALID.includes(sp.range as RollingRange)
    ? (sp.range as RollingRange)
    : '7d';
  const fromIso = parseDateInput(sp.from, 'start');
  const toIso = parseDateInput(sp.to, 'end');

  const card = await loadScorecard(active.id, memberId, active.timezone, {
    range,
    fromIso,
    toIso,
  });
  if (!card) notFound();

  const title = card.member.fullName?.trim() || card.member.email;
  return (
    <>
      <PageHeader
        title={title}
        subtitle={`${card.member.email} · ${card.member.role} · ${active.name}`}
        actions={
          <Link
            href="/team"
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] text-txt-2 hover:bg-surface"
          >
            ← Back to team
          </Link>
        }
      />
      <div className="flex-1 space-y-4 overflow-auto p-6">
        <RangeFilter current={range} fromIso={card.fromIso} toIso={card.toIso} />
        <Scorecard data={card} brandTimezone={active.timezone} />
      </div>
    </>
  );
}

// `<input type="date">` returns YYYY-MM-DD; stamp local 00:00 (start)
// or 23:59:59 (end) so the bound covers the whole picked day.
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
