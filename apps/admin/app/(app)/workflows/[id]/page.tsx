import { notFound } from 'next/navigation';
import { AutomationEditor } from '@/components/automations/automation-editor';
import { getActiveBrand } from '@/lib/active-brand';
import { loadAutomation } from '@/lib/automations';
import { loadDispositions } from '@/lib/dispositions';
import { loadBrandTagsWithCounts } from '@/lib/tags';
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

export default async function AutomationEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const active = await getActiveBrand();
  if (!active) notFound();

  const [automation, stages, tagsWithCounts, dispositions] = await Promise.all([
    loadAutomation(id),
    loadStages(active.id),
    loadBrandTagsWithCounts(active.id),
    loadDispositions(active.id),
  ]);
  if (!automation) notFound();

  return (
    <AutomationEditor
      initial={automation}
      stages={stages}
      tags={tagsWithCounts.map((t) => ({ id: t.id, name: t.name }))}
      dispositions={dispositions.map((d) => ({ code: d.code, label: d.label }))}
    />
  );
}
