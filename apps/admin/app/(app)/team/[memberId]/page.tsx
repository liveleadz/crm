import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Scorecard } from '@/components/team/scorecard';
import { getActiveBrand } from '@/lib/active-brand';
import { canSeeManagement, getCurrentBrandRole } from '@/lib/team';
import { loadScorecard } from '@/lib/scorecard';

export default async function MemberScorecardPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const active = await getActiveBrand();
  if (!active) redirect('/');
  const role = await getCurrentBrandRole(active.id);
  if (!canSeeManagement(role)) redirect('/dashboard');

  const { memberId } = await params;
  const card = await loadScorecard(active.id, memberId, active.timezone);
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
      <div className="flex-1 overflow-auto p-6">
        <Scorecard data={card} brandTimezone={active.timezone} />
      </div>
    </>
  );
}
