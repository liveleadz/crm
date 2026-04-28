import { getActiveBrand } from '@/lib/active-brand';
import { loadKanban } from '@/lib/leads';
import { PageHeader } from '@/components/page-header';
import { KanbanBoard } from '@/components/leads/kanban-board';

export default async function LeadsPage() {
  const active = await getActiveBrand();
  if (!active) return null;
  const { stages, leads } = await loadKanban(active.id);

  const subtitle = `${leads.length.toLocaleString()} total · drag cards to move stages`;

  return (
    <>
      <PageHeader title="Leads" subtitle={subtitle} />
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
