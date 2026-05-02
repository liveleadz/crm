// Server component — renders the team alerts panel. The aggregator is
// fully server-side, no interactivity beyond plain links, so this stays
// out of the client bundle.

import Link from 'next/link';
import type { TeamAlert, TeamAlerts } from '@/lib/team-alerts';

export function TeamAlertsCard({ data }: { data: TeamAlerts }) {
  if (data.alerts.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="text-[12.5px] font-semibold text-txt-2">Manager alerts</h3>
        <p className="mt-1 text-[11.5px] text-txt-3">
          Nothing flagged in the selected window. Reps on pace, no
          voicemail backlog, no paused-but-active campaigns, no
          exhausted lists.
        </p>
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[12.5px] font-semibold text-txt-2">Manager alerts</h3>
        <span className="text-[10.5px] uppercase tracking-wide text-txt-3">
          {data.alerts.length} flagged
        </span>
      </div>
      <ul className="space-y-1.5">
        {data.alerts.map((a, i) => (
          <li key={i}>
            <AlertRow alert={a} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AlertRow({ alert }: { alert: TeamAlert }) {
  switch (alert.kind) {
    case 'underperforming_rep':
      return (
        <Link
          href={`/team/${alert.memberId}`}
          className="flex items-center justify-between rounded-lg border border-line/60 bg-canvas px-3 py-2 text-[12px] hover:border-line"
        >
          <div className="flex items-center gap-2">
            <Dot tone="bad" />
            <span className="font-medium">{alert.name}</span>
            <span className="text-txt-3">conversion behind team</span>
          </div>
          <span className="font-mono text-[11px] text-txt-3">
            {(alert.conversionRate * 100).toFixed(1)}% vs{' '}
            {(alert.teamConversionRate * 100).toFixed(1)}% · {alert.calls} calls
          </span>
        </Link>
      );
    case 'voicemail_backlog':
      return (
        <Link
          href="/inbox"
          className="flex items-center justify-between rounded-lg border border-line/60 bg-canvas px-3 py-2 text-[12px] hover:border-line"
        >
          <div className="flex items-center gap-2">
            <Dot tone="warn" />
            <span className="font-medium">Voicemail backlog</span>
            <span className="text-txt-3">
              {alert.count} unhandled · oldest {alert.oldestHours}h
            </span>
          </div>
          <span className="text-[11px] text-txt-3">Triage →</span>
        </Link>
      );
    case 'paused_with_activity':
      return (
        <Link
          href={`/campaigns/${alert.campaignId}`}
          className="flex items-center justify-between rounded-lg border border-line/60 bg-canvas px-3 py-2 text-[12px] hover:border-line"
        >
          <div className="flex items-center gap-2">
            <Dot tone="warn" />
            <span className="font-medium">{alert.name}</span>
            <span className="text-txt-3">paused but receiving calls</span>
          </div>
          <span className="font-mono text-[11px] text-txt-3">
            {alert.callsLast7d} in last 7d
          </span>
        </Link>
      );
    case 'list_exhausted':
      return (
        <Link
          href={`/leads?listId=${alert.listId}`}
          className="flex items-center justify-between rounded-lg border border-line/60 bg-canvas px-3 py-2 text-[12px] hover:border-line"
        >
          <div className="flex items-center gap-2">
            <Dot tone="info" />
            <span className="font-medium">{alert.name}</span>
            <span className="text-txt-3">running low on dialable leads</span>
          </div>
          <span className="font-mono text-[11px] text-txt-3">
            {(alert.unreachablePct * 100).toFixed(0)}% unreachable · {alert.totalLeads} total
          </span>
        </Link>
      );
  }
}

function Dot({ tone }: { tone: 'bad' | 'warn' | 'info' }) {
  const cls =
    tone === 'bad' ? 'bg-hp' : tone === 'warn' ? 'bg-amber-500' : 'bg-txt-3/70';
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} />;
}
