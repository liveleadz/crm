import { redirect } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import { loadStages } from '@/lib/leads';
import { loadCustomFields } from '@/lib/lists';
import { loadBrandTags } from '@/lib/tags';
import { loadImportPresets } from '@/lib/import-presets';
import { PageHeader } from '@/components/page-header';
import { ImportWizard } from '@/components/leads/import-wizard';

// Page-level data is intentionally minimal: stages + custom fields. We
// previously called loadKanban here just to pluck `stages`, which also
// loaded every lead + every tag join — fine for a fresh brand, slow
// enough to time out on a brand with thousands of leads. The import
// wizard never needs the leads array, so we don't load it.
//
// Both loaders are also wrapped in defensive .catch() so a transient
// Supabase failure shows the wizard with empty fallbacks instead of
// firing the page-scoped error boundary. The user can still upload a
// CSV and pick a stage — the wizard tolerates an empty list of custom
// fields and an empty stages array (it just disables the stage picker).
export default async function ImportLeadsPage() {
  const active = await getActiveBrand();
  if (!active) redirect('/');
  const [stages, customFields, tagLibrary, presets] = await Promise.all([
    loadStages(active.id).catch((err) => {
      console.error('[pipelines/import] loadStages failed', err);
      return [];
    }),
    loadCustomFields(active.id).catch((err) => {
      console.error('[pipelines/import] loadCustomFields failed', err);
      return [];
    }),
    loadBrandTags(active.id).catch((err) => {
      console.error('[pipelines/import] loadBrandTags failed', err);
      return [];
    }),
    loadImportPresets(active.id).catch((err) => {
      console.error('[pipelines/import] loadImportPresets failed', err);
      return [];
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Import leads"
        subtitle={`Upload a CSV and map fields to ${active.name}`}
      />
      <div className="flex-1 overflow-auto p-6">
        <ImportWizard
          stages={stages}
          initialCustomFields={customFields}
          tagLibrary={tagLibrary}
          initialPresets={presets}
        />
      </div>
    </>
  );
}
