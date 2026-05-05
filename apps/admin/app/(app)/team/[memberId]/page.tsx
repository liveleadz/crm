// Phase Q: per-agent performance drill-down.
//
// Manager-only — agents can still open their own page (matches the
// plan's "agent role: 404 unless memberId === self" rule). Reuses the
// reports machinery scoped to a single agent via `loadCallReport({
// agentId })`, then layers on the bits the global Reports page can't:
// presence + on-screen identity, the agent's campaigns linked to the
// per-campaign performance page (Phase P), and a recent-calls table
// with recording links.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Route } from 'next';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { canSeeManagement, getCurrentBrandRole } from '@/lib/team';
import {
  loadAgentPerformance,
  type AgentCampaignRow,
  type AgentRecentCall,
} from '@/lib/agent-performance';
import {
  type DirectionFilter,
  type ReportFilter,
  type ReportRange,
  dispositionLabel,
  formatDuration,
} from '@/lib/reports';
import { PageHeader } from '@/components/page-header';
import { ReportFilters } from '@/components/reports/report-filters';
import {
  DayOfWeekHeatmap,
  DispositionBars,
  KpiCards,
  TrendChart,
} from '@/components/reports/report-cards';
import { LivePulseDot } from '@/components/live-floor/live-pulse-dot';

type SearchParams = {
  range?: string;
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
function isValidDate(d: string | undefined): d is string {
  return !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
}
function startIso(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toISOString();
}
function endIso(date: string): string {
  return new Date(`${date}T23:59:59.999Z`).toISOString();
}

function formatScreenTime(sec: number): string {
  if (!sec || sec <= 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const PRESENCE_LABEL: Record<string, string> = {
  on_call: 'On call',
  active: 'Active',
  idle: 'Idle',
  offline: 'Offline',
};

export const dynamic = 'force-dynamic';

export default async function AgentPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ memberId }, sp, active] = await Promise.all([
    params,
    searchParams,
    getActiveBrand(),
  ]);
  if (!active) notFound();

  const role = await getCurrentBrandRole(active.id);
  if (!canSeeManagement(role)) {
    // Agents can still view their own page.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.id !== memberId) notFound();
  }

  let range = parseRange(sp.range);
  const direction = parseDirection(sp.dir);
  const fromDate = isValidDate(sp.from) ? sp.from : '';
  const toDate = isValidDate(sp.to) ? sp.to : '';
  if (range === 'custom' && (!fromDate || !toDate)) range = '30d';

  const filter: ReportFilter = {
    range,
    direction,
    fromIso: range === 'custom' && fromDate ? startIso(fromDate) : null,
    toIso: range === 'custom' && toDate ? endIso(toDate) : null,
    timezone: active.timezone,
  };

  const perf = await loadAgentPerformance(active.id, memberId, filter);
  if (!perf.identity) notFound();

  const rangeLabel =
    range === '7d'
      ? 'Last 7 days'
      : range === '90d'
        ? 'Last 90 days'
        : range === 'custom' && fromDate && toDate
          ? `${fromDate} → ${toDate}`
          : 'Last 30 days';

  const name = perf.identity.fullName?.trim() || perf.identity.email;
  const subtitle = `${rangeLabel} · ${perf.report.kpis.totalCalls.toLocaleString()} call${perf.report.kpis.totalCalls === 1 ? '' : 's'}`;

  return (
    <>
      <PageHeader
        title={name}
        subtitle={subtitle}
        actions={
          <Link
            href={'/team' as Route}
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:border-teal/60 hover:text-teal"
          >
            Back to team
          </Link>
        }
      />
      <div className="flex-1 space-y-4 overflow-auto p-6">
        {/* Identity strip */}
        <section className="grid gap-3 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <LivePulseDot active={perf.identity.presence === 'on_call'} />
              <h2 className="text-[16px] font-semibold">{name}</h2>
              <span className="rounded-full bg-canvas px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-txt-3">
                {perf.identity.role}
              </span>
              {!perf.identity.isActive && (
                <span className="rounded-full bg-hp/10 px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-hp">
                  Inactive
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[12px] text-txt-3">{perf.identity.email}</div>
            <div className="mt-1 text-[11.5px] text-txt-3">
              {PRESENCE_LABEL[perf.identity.presence] ?? perf.identity.presence}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Stat label="On screen today" value={formatScreenTime(perf.identity.secondsToday)} />
            <Stat label="On screen 7d" value="—" hint="coming soon" />
            <Stat label="On screen 30d" value="—" hint="coming soon" />
          </div>
        </section>

        <ReportFilters
          agents={[]}
          initialRange={range}
          initialAgentId=""
          initialDirection={direction}
          initialFromDate={fromDate}
          initialToDate={toDate}
        />

        <KpiCards kpis={perf.report.kpis} prevKpis={perf.report.prevKpis} />
        <TrendChart points={perf.report.trend} timezone={active.timezone} />
        <DayOfWeekHeatmap cells={perf.report.heatmap} timezone={active.timezone} />

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <CampaignsPanel rows={perf.campaigns} memberId={memberId} />
          <DispositionBars rows={perf.report.byDisposition} />
        </div>

        <RecentCallsTable rows={perf.recentCalls} />
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-canvas/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-txt-3">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-txt-3">{hint}</div>}
    </div>
  );
}

function CampaignsPanel({
  rows,
  memberId,
}: {
  rows: AgentCampaignRow[];
  memberId: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-canvas px-5 py-3">
        <h3 className="text-[13.5px] font-semibold">Campaigns</h3>
        <p className="text-[11.5px] text-txt-3">
          Active campaigns this agent runs. Click to drill into the per-campaign view filtered to this agent.
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12px] text-txt-3">
          Not assigned to any active campaigns.
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3">
              <Link
                href={`/campaigns/${c.id}/performance?agent=${memberId}` as Route}
                className="flex-1 text-[12.5px] font-medium hover:text-teal"
              >
                {c.name}
              </Link>
              <span className="text-[11px] uppercase tracking-wide text-txt-3">
                {c.status}
              </span>
              <span className="text-[12px] tabular-nums text-txt-2">
                {c.callsInRange.toLocaleString()} call{c.callsInRange === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentCallsTable({ rows }: { rows: AgentRecentCall[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line-2 bg-surface p-8 text-center text-[12px] text-txt-3">
        No recent calls.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-canvas px-5 py-3">
        <h3 className="text-[13.5px] font-semibold">Recent calls</h3>
        <p className="text-[11.5px] text-txt-3">
          Last {rows.length} call{rows.length === 1 ? '' : 's'} placed by this agent.
        </p>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-line bg-canvas/50 text-left text-[10.5px] uppercase tracking-wide text-txt-3">
            <th className="px-5 py-2 font-semibold">When</th>
            <th className="px-5 py-2 font-semibold">Lead</th>
            <th className="px-5 py-2 font-semibold">Campaign</th>
            <th className="px-5 py-2 font-semibold">Disposition</th>
            <th className="px-5 py-2 text-right font-semibold">Duration</th>
            <th className="px-5 py-2 text-right font-semibold">Recording</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line last:border-b-0 hover:bg-canvas/40">
              <td className="px-5 py-2 text-txt-2">
                {new Date(r.startedAt).toLocaleString()}
                <span className="ml-1 text-[10px] uppercase tracking-wide text-txt-3">
                  {r.direction === 'inbound' ? '↓ in' : '↑ out'}
                </span>
              </td>
              <td className="px-5 py-2">
                {r.leadId ? (
                  <Link
                    href={`/leads/${r.leadId}` as Route}
                    className="font-medium hover:text-teal"
                  >
                    {r.leadName ?? 'View lead'}
                  </Link>
                ) : (
                  <span className="text-txt-3">Unknown</span>
                )}
              </td>
              <td className="px-5 py-2 text-txt-2">{r.campaignName ?? '—'}</td>
              <td className="px-5 py-2 text-txt-2">
                {r.disposition ? dispositionLabel(r.disposition) : '—'}
              </td>
              <td className="px-5 py-2 text-right tabular-nums text-txt-2">
                {formatDuration(r.durationSec ?? 0)}
              </td>
              <td className="px-5 py-2 text-right">
                {r.recordingUrl ? (
                  <a
                    href={r.recordingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11.5px] text-teal hover:underline"
                  >
                    Listen
                  </a>
                ) : (
                  <span className="text-[11.5px] text-txt-3">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
