import Link from 'next/link';
import { getActiveBrand } from '@/lib/active-brand';
import { loadKanban } from '@/lib/leads';
import { loadLists } from '@/lib/lists';
import { loadBrandTags } from '@/lib/tags';
import { PageHeader } from '@/components/page-header';
import { KanbanBoard } from '@/components/leads/kanban-board';
import { NewLeadButton } from '@/components/leads/new-lead-button';
import { ListPills } from '@/components/leads/list-pills';
import { LeadFilters } from '@/components/leads/lead-filters';

export default async function LeadsPage({
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

  const [{ stages, leads }, lists, tagLibrary] = await Promise.all([
    loadKanban(active.id, {
      listId: activeListId,
      search,
      source,
      tagIds,
      excludeDnc,
      excludeDne,
    }),
    loadLists(active.id),
    loadBrandTags(active.id),
  ]);

  const activeList = activeListId ? lists.find((l) => l.id === activeListId) ?? null : null;
  const filtersActive =
    !!search || !!source || tagIds.length > 0 || excludeDnc || excludeDne;
  const subtitle = activeList
    ? `${leads.length.toLocaleString()} in ${activeList.name}${filtersActive ? ' · filtered' : ''} · drag cards to move stages`
    : `${leads.length.toLocaleString()}${filtersActive ? ' filtered' : ' total'} · drag cards to move stages`;

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle={subtitle}
        actions={
          stages.length > 0 ? (
            <>
              <Link
                href="/leads/import"
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas"
              >
                Import CSV
              </Link>
              <NewLeadButton stages={stages} />
            </>
          ) : null
        }
      />
      {lists.length > 0 && (
        <ListPills lists={lists} activeListId={activeListId} />
      )}
      <LeadFilters
        tagLibrary={tagLibrary}
        initialSearch={search ?? ''}
        initialSource={source ?? ''}
        initialTagIds={tagIds}
        initialDnc={excludeDnc}
        initialDne={excludeDne}
      />
      {stages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-12">
          <div className="max-w-md rounded-lg border border-dashed border-line-2 bg-surface p-8 text-center">
            <p className="text-[12.5px] text-txt-3">
              No stages configured for {active.name}. Add stages in Settings to start the
              pipeline.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <KanbanBoard stages={stages} leads={leads} />
        </div>
      )}
    </>
  );
}
