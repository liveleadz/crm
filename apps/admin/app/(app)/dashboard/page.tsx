import { getActiveBrand } from '@/lib/active-brand';
import { loadDashboard } from '@/lib/dashboard';
import { loadAgentCampaignSummary } from '@/lib/campaigns';
import { getMyProfile } from '@/lib/dialer';
import { getCurrentBrandRole } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { PipelineByStage } from '@/components/dashboard/pipeline-by-stage';
import { RecentCalls } from '@/components/dashboard/recent-calls';
import { TodaysAppointments } from '@/components/dashboard/todays-appointments';
import { TodayOutcomes } from '@/components/dashboard/today-outcomes';
import { RecentImports } from '@/components/dashboard/recent-imports';
import { TopTags } from '@/components/dashboard/top-tags';
import { MyCampaigns } from '@/components/dashboard/my-campaigns';
import { InboundCard } from '@/components/dashboard/inbound-card';
import { RealtimeRefresher } from '@/components/realtime-refresher';

export default async function DashboardPage() {
  const active = await getActiveBrand();
  if (!active) return null;
  const profile = await getMyProfile();
  // Agents/viewers see only their own work; manager+ sees brand-wide
  // aggregates. Reuses the existing role lookup (cached per request via
  // the brand_role RPC).
  const role = await getCurrentBrandRole(active.id);
  const viewerMemberId =
    profile && (role === 'agent' || role === 'viewer') ? profile.id : null;
  const [
    {
      kpis,
      pipeline,
      recentCalls,
      todayAppointments,
      todayOutcomes,
      recentImports,
      topTags,
    },
    myCampaigns,
  ] = await Promise.all([
    loadDashboard(active.id, { viewerMemberId }),
    profile ? loadAgentCampaignSummary(active.id, profile.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`${active.name} — last 7 days`} />
      <RealtimeRefresher channel="dashboard-kpis" tables={['calls', 'leads', 'appointments']} />
      <div className="flex-1 space-y-5 overflow-auto p-6">
        <KpiCards kpis={kpis} />

        {myCampaigns.length > 0 && <MyCampaigns campaigns={myCampaigns} />}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PipelineByStage pipeline={pipeline} />
          </div>
          <div className="space-y-4">
            <InboundCard brandId={active.id} />
            <RecentCalls calls={recentCalls} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <TodayOutcomes outcomes={todayOutcomes} />
          <RecentImports imports={recentImports} />
          <TopTags tags={topTags} />
        </div>

        <TodaysAppointments appointments={todayAppointments} />
      </div>
    </>
  );
}
