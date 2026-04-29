import { getActiveBrand } from '@/lib/active-brand';
import { loadKanban } from '@/lib/leads';
import { loadBrandTagsWithCounts } from '@/lib/tags';
import { PageHeader } from '@/components/page-header';
import { StagesManager } from '@/components/settings/stages-manager';
import { TagsManager } from '@/components/settings/tags-manager';

export default async function SettingsPage() {
  const active = await getActiveBrand();
  if (!active) return null;
  const [{ stages }, tags] = await Promise.all([
    loadKanban(active.id),
    loadBrandTagsWithCounts(active.id),
  ]);
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`${active.name} · pipeline configuration`}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <section>
            <h2 className="mb-1 text-[13px] font-semibold">Pipeline stages</h2>
            <p className="mb-4 text-[12px] text-txt-3">
              Stages are brand-scoped and shown left-to-right on the leads kanban. Mark a
              stage as Won or Lost to drive reporting.
            </p>
            <StagesManager initialStages={stages} />
          </section>
          <section>
            <h2 className="mb-1 text-[13px] font-semibold">Tags</h2>
            <p className="mb-4 text-[12px] text-txt-3">
              Tags categorize leads across pipelines. Rename or recolor any tag here, or
              delete one to detach it from every lead.
            </p>
            <TagsManager initialTags={tags} />
          </section>
        </div>
      </div>
    </>
  );
}
