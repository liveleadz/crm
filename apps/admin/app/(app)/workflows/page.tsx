import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { AutomationsManager } from '@/components/automations/automations-manager';
import { getActiveBrand } from '@/lib/active-brand';
import { loadAutomations } from '@/lib/automations';
import { loadDispositions } from '@/lib/dispositions';
import { loadBrandTagsWithCounts } from '@/lib/tags';
import { canSeeManagement, getCurrentBrandRole } from '@/lib/team';
import { createServerClient } from '@leadpilot/db/server';

async function loadStages(brandId: string) {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('stages')
    .select('id, name')
    .eq('brand_id', brandId)
    .order('position');
  return (data ?? []).map((s) => ({ id: s.id, name: s.name }));
}

export default async function WorkflowsPage() {
  const active = await getActiveBrand();

  if (!active) {
    return (
      <>
        <PageHeader title="Automations" subtitle="No active brand selected." />
      </>
    );
  }

  // Manager+ only. Agents and viewers must not see automation rules; we
  // 404 instead of redirecting so the URL doesn't leak the page's existence.
  const role = await getCurrentBrandRole(active.id);
  if (!canSeeManagement(role)) notFound();

  const [automations, stages, tagsWithCounts, dispositions] = await Promise.all([
    loadAutomations(active.id),
    loadStages(active.id),
    loadBrandTagsWithCounts(active.id),
    loadDispositions(active.id),
  ]);

  return (
    <>
      <PageHeader
        title="Automations"
        subtitle={`Trigger → action rules · ${active.name}`}
      />
      <div className="flex-1 overflow-auto p-6">
        <AutomationsManager
          initial={automations}
          stages={stages}
          tags={tagsWithCounts.map((t) => ({ id: t.id, name: t.name }))}
          dispositions={dispositions.map((d) => ({ code: d.code, label: d.label }))}
        />
      </div>
    </>
  );
}
