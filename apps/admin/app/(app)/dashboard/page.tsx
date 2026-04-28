import { getActiveBrand } from '@/lib/active-brand';
import { PageHeader, StubBody } from '@/components/page-header';

export default async function DashboardPage() {
  const active = await getActiveBrand();
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={active ? `${active.name} — last 7 days` : undefined}
      />
      <StubBody note="KPI cards, recent calls, pipeline strip, and realtime activity feed land in Sprint 1.2." />
    </>
  );
}
