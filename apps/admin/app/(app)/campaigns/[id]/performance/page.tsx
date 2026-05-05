// Phase P: per-campaign performance page.
//
// Manager-only. Reuses ReportFilters, KpiCards, TrendChart, AgentTable,
// DispositionBars, DayOfWeekHeatmap from the global reports page — but
// scoped to one campaign via the new `campaignId` filter on
// loadCallReport. Adds a "live now" strip at the top so a manager can
// see who's working this campaign right this second, and a category
// breakdown row so the brand-wide disposition taxonomy is visible
// inline (% wrong number / % no answer / % appointment set, with both
// percentages and absolutes).

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Route } from 'next';
import { getActiveBrand } from '@/lib/active-brand';
import { loadCampaign } from '@/lib/campaigns';
import { getCurrentBrandRole, loadTeam, type MemberRole } from '@/lib/team';
import { loadCampaignPerformance } from '@/lib/campaign-performance';
import {
  type DirectionFilter,
  type ReportFilter,
  type ReportRange,
  formatPct,
} from '@/lib/reports';
import { PageHeader } from '@/components/page-header';
import { ReportFilters } from '@/components/reports/report-filters';
import {
  AgentTable,
  DayOfWeekHeatmap,
  DispositionBars,
  KpiCards,
  TrendChart,
} from '@/components/reports/report-cards';
import { LivePulseDot } from '@/components/live-floor/live-pulse-dot';

type SearchParams = {
  range?: string;
  agent?: string;
  dir?: string;
  from?: string;
  to?: string;
};

function canSeePerformance(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

function parseRange(value: string | undefined): ReportRange {
  if (value === '7d' || value === '90d' || value === 'custom') return value;
  return '30d';
}
function parseDirection(value: string | undefined): DirectionFilter {
  if (value === 'inbound' || value === 'outbound') return value;
  return 'all';
}
function isValidDate(d: string | undefined): d is string {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
}
function startIso(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}
function endIso(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}

export const dynamic = 'force-dynamic';

export default async function CampaignPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp, active] = await Promise.all([params, searchParams, getActiveBrand()]);
  if (!active) notFound();
  const role = await getCurrentBrandRole(active.id);
  if (!canSeePerformance(role)) notFound();

  const campaign = await loadCampaign(id);
  if (!campaign || campaign.brandId !== active.id) notFound();

  let range = parseRange(sp.range);
  const direction = parseDirection(sp.dir);
  const agentId = sp.agent && sp.agent.length > 0 ? sp.agent : null;
  const fromDate = isValidDate(sp.from) ? sp.from : '';
  const toDate = isValidDate(sp.to) ? sp.to : '';
  if (range === 'custom' && (!fromDate || !toDate)) range = '30d';

  const filter: ReportFilter = {
    range,
    agentId,
    direction,
    fromIso: range === 'custom' && fromDate ? startIso(fromDate) : null,
    toIso: range === 'custom' && toDate ? endIso(toDate) : null,
    timezone: active.timezone,
  };

  const [perf, team] = await Promise.all([
    loadCampaignPerformance(active.id, id, filter),
    loadTeam(active.id),
  ]);

  // Roster filter for the agent dropdown — only show agents assigned to
  // this campaign, since the rest will always read 0.
  const rosterIds = new Set(campaign.agentIds);
  const agents = team
    .filter((m) => m.isActive && rosterIds.has(m.memberId))
    .map((m) => ({ id: m.memberId, name: m.fullName?.trim() || m.email }));

  const rangeLabel =
    range === '7d'
      ? 'Last 7 days'
      : range === '90d'
        ? 'Last 90 days'
        : range === 'custom' && fromDate && toDate
          ? `${fromDate} → ${toDate}`
          : 'Last 30 days';

  const onCall = perf.activeCalls.length;
  const subtitle = `${rangeLabel} · ${perf.report.kpis.totalCalls.toLocaleString()} call${perf.report.kpis.totalCalls === 1 ? '' : 's'}${onCall > 0 ? ` · ${onCall} live now` : ''}`;

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`Performance · ${subtitle}`}
        actions={
          <Link
            href={`/campaigns/${campaign.id}` as Route}
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:border-teal/60 hover:text-teal"
          >
            Edit campaign
          </Link>
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

        {perf.liveAgents.length > 0 && (
          <section className="rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line bg-canvas px-5 py-3">
              <div>
                <h3 className="text-[13.5px] font-semibold">Roster · live now</h3>
                <p className="text-[11.5px] text-txt-3">
                  Agents assigned to this campaign and their presence right now.
                </p>
              </div>
              <span className="text-[11px] text-txt-3">
                {onCall} on this campaign · {perf.liveAgents.length} on roster
              </span>
            </div>
            <ul className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
              {perf.liveAgents.map((a) => (
                <li
                  key={a.memberId}
                  className="flex items-center gap-3 rounded-lg border border-line bg-canvas/40 px-3 py-2"
                >
                  <LivePulseDot active={a.presence === 'on_call'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium">{a.name}</div>
                    <div className="truncate text-[11px] text-txt-3">
                      {a.presence === 'on_call' && a.currentCall
                        ? `On call · ${a.currentCall.leadName ?? a.currentCall.toNumber}`
                        : a.presence.replace('_', ' ')}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <KpiCards kpis={perf.report.kpis} prevKpis={perf.report.prevKpis} />
        <CategoryStrip kpis={perf.report.kpis} />
        <TrendChart points={perf.report.trend} timezone={active.timezone} />
        <DayOfWeekHeatmap cells={perf.report.heatmap} timezone={active.timezone} />
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <AgentTable rows={perf.report.byAgent} activeAgentId={agentId} />
          <DispositionBars rows={perf.report.byDisposition} />
        </div>
      </div>
    </>
  );
}

// Headline category strip — the "% wrong number / % no answer /
// % appointment set" row that managers ask for. Categories are stable
// across brand-renamed labels (Phase M).
function CategoryStrip({
  kpis,
}: {
  kpis: import('@/lib/reports').ReportKpis;
}) {
  const cells: Array<{ label: string; count: number; rate: number; tone: string }> = [
    {
      label: 'Appointment set',
      count: kpis.appointmentSetCount,
      rate: kpis.appointmentSetRate,
      tone: 'text-amber-500',
    },
    {
      label: 'Connected',
      count: kpis.connectedCalls,
      rate: kpis.connectRate,
      tone: 'text-teal',
    },
    {
      label: 'Callback',
      count: kpis.callbackCount,
      rate: kpis.callbackRate,
      tone: 'text-sky-500',
    },
    {
      label: 'Voicemail',
      count: kpis.voicemailCount,
      rate: kpis.voicemailRate,
      tone: 'text-violet-500',
    },
    {
      label: 'No answer',
      count: kpis.noAnswerCount,
      rate: kpis.noAnswerRate,
      tone: 'text-txt-2',
    },
    {
      label: 'Wrong number',
      count: kpis.wrongNumberCount,
      rate: kpis.wrongNumberRate,
      tone: 'text-rose-500',
    },
    {
      label: 'Not interested',
      count: kpis.notInterestedCount,
      rate: kpis.notInterestedRate,
      tone: 'text-slate-500',
    },
    {
      label: 'Do not call',
      count: kpis.doNotCallCount,
      rate: kpis.doNotCallRate,
      tone: 'text-rose-500',
    },
  ];
  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-canvas px-5 py-3">
        <h3 className="text-[13.5px] font-semibold">Outcome mix</h3>
        <p className="text-[11.5px] text-txt-3">
          Each cell shows the count and the share of total calls in this range.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-px bg-line/60 sm:grid-cols-4 lg:grid-cols-8">
        {cells.map((c) => (
          <li key={c.label} className="bg-surface px-4 py-3">
            <div className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              {c.label}
            </div>
            <div className={`mt-0.5 text-[16px] font-semibold tabular-nums ${c.tone}`}>
              {c.count.toLocaleString()}
            </div>
            <div className="text-[11px] text-txt-3 tabular-nums">{formatPct(c.rate)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
