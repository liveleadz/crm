// Reports dashboard — wires URL search params (range/agent/dir) to the
// report data loader and renders KPIs, daily trend, per-agent table, and
// disposition mix. CSV export pulls from the same loader via a server
// action.

import { redirect } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import { loadCallReport, type DirectionFilter } from '@/lib/reports';
import { loadTeam } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { ReportFilters } from '@/components/reports/report-filters';
import {
  AgentTable,
  DispositionBars,
  KpiCards,
  TrendChart,
} from '@/components/reports/report-cards';
import { ExportButton } from '@/components/reports/export-button';

type SearchParams = {
  range?: string;
  agent?: string;
  dir?: string;
};

function parseRange(value: string | undefined): '7d' | '30d' | '90d' {
  if (value === '7d' || value === '90d') return value;
  return '30d';
}

function parseDirection(value: string | undefined): DirectionFilter {
  if (value === 'inbound' || value === 'outbound') return value;
  return 'all';
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const active = await getActiveBrand();
  if (!active) redirect('/');

  const range = parseRange(sp.range);
  const direction = parseDirection(sp.dir);
  const agentId = sp.agent && sp.agent.length > 0 ? sp.agent : null;

  const [report, team] = await Promise.all([
    loadCallReport(active.id, { range, agentId, direction }),
    loadTeam(active.id),
  ]);

  const agents = team
    .filter((m) => m.isActive)
    .map((m) => ({
      id: m.memberId,
      name: m.fullName?.trim() || m.email,
    }));

  const subtitle = `${range === '7d' ? 'Last 7 days' : range === '90d' ? 'Last 90 days' : 'Last 30 days'} · ${report.kpis.totalCalls.toLocaleString()} call${report.kpis.totalCalls === 1 ? '' : 's'}`;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={subtitle}
        actions={
          <ExportButton range={range} agentId={agentId} direction={direction} />
        }
      />
      <div className="flex-1 space-y-4 overflow-auto p-6">
        <ReportFilters
          agents={agents}
          initialRange={range}
          initialAgentId={agentId ?? ''}
          initialDirection={direction}
        />
        <KpiCards kpis={report.kpis} />
        <TrendChart points={report.trend} />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <AgentTable rows={report.byAgent} />
          <DispositionBars rows={report.byDisposition} />
        </div>
      </div>
    </>
  );
}
