import { PageHeader } from '@/components/page-header';
import { getActiveBrand } from '@/lib/active-brand';
import { loadNumbersWithHealth } from '@/lib/numbers';
import { NumbersManager } from '@/components/numbers/numbers-manager';

export default async function NumbersPage() {
  const active = await getActiveBrand();
  if (!active) {
    return (
      <>
        <PageHeader title="Numbers & Routing" subtitle="Phone numbers, A2P campaigns, routing" />
        <div className="p-6 text-[12.5px] text-txt-3">No active brand.</div>
      </>
    );
  }

  const numbers = await loadNumbersWithHealth(active.id);
  const swReady = !!(
    process.env.SIGNALWIRE_PROJECT_ID &&
    process.env.SIGNALWIRE_TOKEN &&
    process.env.SIGNALWIRE_SPACE_URL
  );

  const subtitle =
    numbers.length === 0
      ? 'Phone numbers, A2P campaigns, routing — sync from SignalWire to get started.'
      : `${numbers.length} number${numbers.length === 1 ? '' : 's'} · ${numbers.filter((n) => n.active).length} active`;

  return (
    <>
      <PageHeader title="Numbers & Routing" subtitle={subtitle} />
      <NumbersManager initial={numbers} swReady={swReady} />
    </>
  );
}
