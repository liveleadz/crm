// Reports dashboard — wires URL search params (range/agent/dir/from/to)
// to the report data loader and renders KPIs, daily trend, per-agent
// table, and disposition mix. CSV export pulls from the same loader via
// a server action. Tabs route between Calls / Email / Pipeline /
// Appointments / SMS via ?tab=<kind>.

import { redirect } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import {
  loadCallReport,
  loadEmailReport,
  loadPipelineReport,
  loadAppointmentsReport,
  loadSmsReport,
  type DirectionFilter,
  type ReportFilter,
  type ReportRange,
} from '@/lib/reports';
import { loadTeam } from '@/lib/team';
import { PageHeader } from '@/components/page-header';
import { ReportFilters } from '@/components/reports/report-filters';
import { ReportTabs, type ReportTab } from '@/components/reports/report-tabs';
import {
  AgentTable,
  DayOfWeekHeatmap,
  DispositionBars,
  KpiCards,
  SourceFunnel,
  TrendChart,
} from '@/components/reports/report-cards';
import { EmailReportView } from '@/components/reports/email-report';
import { PipelineReportView } from '@/components/reports/pipeline-report';
import { AppointmentsReportView } from '@/components/reports/appointments-report';
import { SmsReportView } from '@/components/reports/sms-report';
import { ExportButton } from '@/components/reports/export-button';

type SearchParams = {
  tab?: string;
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

function parseTab(value: string | undefined): ReportTab {
  if (
    value === 'email' ||
    value === 'pipeline' ||
    value === 'appointments' ||
    value === 'sms'
  )
    return value;
  return 'calls';
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

  const tab = parseTab(sp.tab);
  let range = parseRange(sp.range);
  const direction = parseDirection(sp.dir);
  const agentId = sp.agent && sp.agent.length > 0 ? sp.agent : null;

  const fromDate = isValidDate(sp.from) ? sp.from : '';
  const toDate = isValidDate(sp.to) ? sp.to : '';
  // If range=custom but the dates are missing/invalid, fall back to 30d.
  if (range === 'custom' && (!fromDate || !toDate)) range = '30d';

  const filter: ReportFilter = {
    range,
    agentId,
    direction,
    fromIso: range === 'custom' && fromDate ? startIso(fromDate) : null,
    toIso: range === 'custom' && toDate ? endIso(toDate) : null,
    timezone: active.timezone,
  };

  const team = await loadTeam(active.id);
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

  // Load the tab-specific report. Each branch produces both the rendered
  // body and a subtitle so the header reflects what's on screen.
  let body: React.ReactNode;
  let subtitle: string;
  if (tab === 'email') {
    const report = await loadEmailReport(active.id, filter);
    subtitle = `${rangeLabel} · ${report.kpis.sent.toLocaleString()} sent · ${report.kpis.received.toLocaleString()} received`;
    body = <EmailReportView report={report} />;
  } else if (tab === 'pipeline') {
    const report = await loadPipelineReport(active.id, filter);
    subtitle = `${rangeLabel} · ${report.totalLeads.toLocaleString()} lead${report.totalLeads === 1 ? '' : 's'}`;
    body = <PipelineReportView report={report} />;
  } else if (tab === 'appointments') {
    const report = await loadAppointmentsReport(active.id, filter);
    subtitle = `${rangeLabel} · ${report.kpis.booked.toLocaleString()} booked`;
    body = <AppointmentsReportView report={report} />;
  } else if (tab === 'sms') {
    const report = await loadSmsReport(active.id, filter);
    subtitle = `${rangeLabel} · ${report.kpis.sent.toLocaleString()} sent`;
    body = <SmsReportView report={report} />;
  } else {
    const report = await loadCallReport(active.id, filter);
    subtitle = `${rangeLabel} · ${report.kpis.totalCalls.toLocaleString()} call${report.kpis.totalCalls === 1 ? '' : 's'}`;
    body = (
      <>
        <KpiCards kpis={report.kpis} prevKpis={report.prevKpis} />
        <TrendChart points={report.trend} timezone={active.timezone} />
        <DayOfWeekHeatmap cells={report.heatmap} timezone={active.timezone} />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <AgentTable rows={report.byAgent} activeAgentId={agentId} />
          <DispositionBars rows={report.byDisposition} />
        </div>
        <SourceFunnel rows={report.bySource} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={subtitle}
        actions={
          <ExportButton
            tab={tab}
            range={range}
            agentId={agentId}
            direction={direction}
            fromDate={fromDate || null}
            toDate={toDate || null}
          />
        }
      />
      <div className="flex-1 space-y-4 overflow-auto p-6">
        <ReportTabs current={tab} />
        <ReportFilters
          agents={agents}
          initialRange={range}
          initialAgentId={agentId ?? ''}
          initialDirection={direction}
          initialFromDate={fromDate}
          initialToDate={toDate}
        />
        {body}
      </div>
    </>
  );
}
