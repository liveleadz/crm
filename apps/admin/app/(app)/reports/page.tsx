// Reports dashboard — wires URL search params (range/agent/dir/from/to)
// to the report data loader and renders KPIs, daily trend, per-agent
// table, and disposition mix. CSV export pulls from the same loader via
// a server action.

import { redirect } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import {
  loadCallReport,
  type DirectionFilter,
  type ReportRange,
} from '@/lib/reports';
import { loadTeam } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { ReportFilters } from '@/components/reports/report-filters';
import {
  AgentTable,
  DayOfWeekHeatmap,
  DispositionBars,
  KpiCards,
  SourceFunnel,
  TrendChart,
} from '@/components/reports/report-cards';
import { ExportButton } from '@/components/reports/export-button';

type SearchParams = {
  range?: string;
  agent?: string;
  dir?: string;
  from?: string;
  to?: string;
};

function parseRange(value: string | undefined): ReportRange {
  if (value === '7d' || value === '90d' || value === 'custom') return value;
  return '30d';
}

function parseDirection(value: string | undefined): DirectionFilter {
  if (value === 'inbound' || value === 'outbound') return value;
  return 'all';
}

// Treat YYYY-MM-DD strings as full UTC days. `from` becomes 00:00:00,
// `to` becomes 23:59:59.999 so the picker is inclusive on both ends.
function startIso(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}
function endIso(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}

function isValidDate(d: string | undefined): d is string {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const active = await getActiveBrand();
  if (!active) redirect('/');

  let range = parseRange(sp.range);
  const direction = parseDirection(sp.dir);
  const agentId = sp.agent && sp.agent.length > 0 ? sp.agent : null;

  const fromDate = isValidDate(sp.from) ? sp.from : '';
  const toDate = isValidDate(sp.to) ? sp.to : '';
  // If range=custom but the dates are missing/invalid, fall back to 30d.
  if (range === 'custom' && (!fromDate || !toDate)) range = '30d';

  const [report, team] = await Promise.all([
    loadCallReport(active.id, {
      range,
      agentId,
      direction,
      fromIso: range === 'custom' && fromDate ? startIso(fromDate) : null,
      toIso: range === 'custom' && toDate ? endIso(toDate) : null,
      timezone: active.timezone,
    }),
    loadTeam(active.id),
  ]);

  const agents = team
    .filter((m) => m.isActive)
    .map((m) => ({
      id: m.memberId,
      name: m.fullName?.trim() || m.email,
    }));

  const rangeLabel =
    range === '7d'
      ? 'Last 7 days'
      : range === '90d'
        ? 'Last 90 days'
        : range === 'custom' && fromDate && toDate
          ? `${fromDate} → ${toDate}`
          : 'Last 30 days';
  const subtitle = `${rangeLabel} · ${report.kpis.totalCalls.toLocaleString()} call${report.kpis.totalCalls === 1 ? '' : 's'}`;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={subtitle}
        actions={
          <ExportButton
            range={range}
            agentId={agentId}
            direction={direction}
            fromDate={fromDate || null}
            toDate={toDate || null}
          />
        }
      />
      <div className="flex-1 space-y-4 overflow-auto p-6">
        <ReportFilters
          agents={agents}
          initialRange={range}
          initialAgentId={agentId ?? ''}
          initialDirection={direction}
          initialFromDate={fromDate}
          initialToDate={toDate}
        />
        <KpiCards kpis={report.kpis} prevKpis={report.prevKpis} />
        <TrendChart points={report.trend} timezone={active.timezone} />
        <DayOfWeekHeatmap cells={report.heatmap} timezone={active.timezone} />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <AgentTable rows={report.byAgent} activeAgentId={agentId} />
          <DispositionBars rows={report.byDisposition} />
        </div>
        <SourceFunnel rows={report.bySource} />
      </div>
    </>
  );
}
