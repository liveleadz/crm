import { redirect } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import { loadStages } from '@/lib/leads';
import { loadCustomFields } from '@/lib/lists';
import { PageHeader } from '@/components/page-header';
import { ImportWizard } from '@/components/leads/import-wizard';

// Page-level data is intentionally minimal: stages + custom fields. We
// previously called loadKanban here just to pluck `stages`, which also
// loaded every lead + every tag join — fine for a fresh brand, slow
// enough to time out on a brand with thousands of leads. The import
// wizard never needs the leads array, so we don't load it.
export default async function ImportLeadsPage() {
  const active = await getActiveBrand();
  if (!active) redirect('/');
  const [stages, customFields] = await Promise.all([
    loadStages(active.id),
    loadCustomFields(active.id),
  ]);

  return (
    <>
      <PageHeader
        title="Import leads"
        subtitle={`Upload a CSV and map fields to ${active.name}`}
      />
      <div className="flex-1 overflow-auto p-6">
        <ImportWizard stages={stages} initialCustomFields={customFields} />
      </div>
    </>
  );
}
