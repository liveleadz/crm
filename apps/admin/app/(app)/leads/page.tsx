// Flat-list view of every lead in the active brand. Companion to
// /pipelines (which presents the same data on a Kanban). Surfaces all
// leads at a glance, with the same Smart Lists / Filters / Import / New
// affordances and an LeadDetailDrawer click-to-expand for inline editing.

import Link from 'next/link';
import { getActiveBrand } from '@/lib/active-brand';
import { loadKanban } from '@/lib/leads';
import { loadLists } from '@/lib/lists';
import { loadBrandTags } from '@/lib/tags';
import { getCurrentBrandRole, loadTeam } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { LeadFilters } from '@/components/leads/lead-filters';
import { ListPills } from '@/components/leads/list-pills';
import { NewLeadButton } from '@/components/leads/new-lead-button';
import { LeadsTable } from '@/components/leads/leads-table';
import { RealtimeRefresher } from '@/components/realtime-refresher';

export default async function LeadsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    list?: string;
    q?: string;
    source?: string;
    tags?: string;
    dnc?: string;
    dne?: string;
  }>;
}) {
  const active = await getActiveBrand();
  if (!active) return null;
  const sp = await searchParams;
  const activeListId = sp.list ?? null;
  const search = sp.q?.trim() || null;
  const source = sp.source?.trim() || null;
  const tagIds = sp.tags
    ? sp.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const excludeDnc = sp.dnc === '1';
  const excludeDne = sp.dne === '1';

  const [lists, tagLibrary, team, role] = await Promise.all([
    loadLists(active.id),
    loadBrandTags(active.id),
    loadTeam(active.id),
    getCurrentBrandRole(active.id),
  ]);

  // Filter-source (smart) lists carry their criteria in URL params (set by
  // the pill href). For those we do NOT scope by list_id — leads aren't
  // materialized into them. For import/manual lists we still scope by id.
  const activeList = activeListId ? lists.find((l) => l.id === activeListId) ?? null : null;
  const materializedListId = activeList && activeList.source !== 'filter' ? activeList.id : null;

  const { stages, leads, total } = await loadKanban(
    active.id,
    {
      listId: materializedListId,
      search,
      source,
      tagIds,
      excludeDnc,
      excludeDne,
    },
    role,
  );

  const teamOpts = team.map((t) => ({
    id: t.memberId,
    name: t.fullName ?? t.email,
  }));

  const filtersActive =
    !!search || !!source || tagIds.length > 0 || excludeDnc || excludeDne;
  const subtitle = `${total.toLocaleString()}${filtersActive ? ' filtered' : ' total'}`;

  const stageById = new Map(stages.map((s) => [s.id, s]));

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={subtitle}
        actions={
          stages.length > 0 ? (
            <>
              <Link
                href="/pipelines/import"
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas"
              >
                Import CSV
              </Link>
              <NewLeadButton stages={stages} />
            </>
          ) : null
        }
      />
      <RealtimeRefresher channel="leads-list" tables={['leads']} />
      {lists.length > 0 && <ListPills lists={lists} activeListId={activeListId} />}
      <LeadFilters
        tagLibrary={tagLibrary}
        initialSearch={search ?? ''}
        initialSource={source ?? ''}
        initialTagIds={tagIds}
        initialDnc={excludeDnc}
        initialDne={excludeDne}
        activeSmartList={
          activeList && activeList.source === 'filter'
            ? { id: activeList.id, name: activeList.name }
            : null
        }
      />
      {stages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="max-w-md rounded-lg border border-dashed border-line-2 bg-surface p-8 text-center">
            <p className="text-[12.5px] text-txt-3">
              No stages configured for {active.name}. Add stages in Settings to start tracking
              leads.
            </p>
          </div>
        </div>
      ) : (
        <LeadsTable
          leads={leads}
          stages={stages}
          stageById={Object.fromEntries(stageById)}
          tagLibrary={tagLibrary}
          team={teamOpts}
        />
      )}
    </>
  );
}
