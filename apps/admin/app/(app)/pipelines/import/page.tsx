import { redirect } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import { loadKanban } from '@/lib/leads';
import { loadCustomFields } from '@/lib/lists';
import { PageHeader } from '@/components/page-header';
import { ImportWizard } from '@/components/leads/import-wizard';

export default async function ImportLeadsPage() {
  const active = await getActiveBrand();
  if (!active) redirect('/');
  const [{ stages }, customFields] = await Promise.all([
    loadKanban(active.id),
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
