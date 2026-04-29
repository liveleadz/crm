import { getActiveBrand } from '@/lib/active-brand';
import { loadCalls } from '@/lib/calls';
import { loadKanban } from '@/lib/leads';
import { loadDispositions } from '@/lib/dispositions';
import { PageHeader } from '@/components/page-header';
import { CallsList } from '@/components/calls/calls-list';

export default async function CallsPage() {
  const active = await getActiveBrand();
  if (!active) return null;
  const [calls, { stages }, dispositions] = await Promise.all([
    loadCalls(active.id),
    loadKanban(active.id),
    loadDispositions(active.id),
  ]);
  const subtitle = `${calls.length.toLocaleString()} call${calls.length === 1 ? '' : 's'}`;
  return (
    <>
      <PageHeader title="Calls" subtitle={subtitle} />
      <CallsList stages={stages} calls={calls} dispositions={dispositions} />
    </>
  );
}
