import { getActiveBrand } from '@/lib/active-brand';
import { loadDashboard } from '@/lib/dashboard';
import { PageHeader } from '@/components/page-header';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { PipelineByStage } from '@/components/dashboard/pipeline-by-stage';
import { RecentCalls } from '@/components/dashboard/recent-calls';
import { TodaysAppointments } from '@/components/dashboard/todays-appointments';
import { DashboardRealtimeRefresher } from '@/components/dashboard/realtime-refresher';

export default async function DashboardPage() {
  const active = await getActiveBrand();
  if (!active) return null;
  const { kpis, pipeline, recentCalls, todayAppointments } = await loadDashboard(active.id);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`${active.name} — last 7 days`} />
      <DashboardRealtimeRefresher />
      <div className="flex-1 space-y-5 overflow-auto p-6">
        <KpiCards kpis={kpis} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PipelineByStage pipeline={pipeline} />
          </div>
          <RecentCalls calls={recentCalls} />
        </div>

        <TodaysAppointments appointments={todayAppointments} />
      </div>
    </>
  );
}
