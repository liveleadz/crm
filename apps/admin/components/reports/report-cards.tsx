// Server-rendered report widgets: KPI tiles, per-agent table,
// disposition breakdown bars, daily trend sparkline. Pure presentation
// — all aggregation lives in lib/reports.ts.

import {
  type AgentRow,
  type DispositionRow,
  type ReportKpis,
  type TrendPoint,
  dispositionLabel,
  formatDuration,
  formatPct,
} from '@/lib/reports';

export function KpiCards({ kpis }: { kpis: ReportKpis }) {
  const tiles: Array<{
    label: string;
    value: string;
    sub?: string;
    tone?: 'default' | 'teal' | 'amber';
  }> = [
    {
      label: 'Total calls',
      value: kpis.totalCalls.toLocaleString(),
      sub: `${kpis.inboundCalls.toLocaleString()} in · ${kpis.outboundCalls.toLocaleString()} out`,
    },
    {
      label: 'Connected',
      value: kpis.connectedCalls.toLocaleString(),
      sub: formatPct(kpis.connectRate) + ' connect rate',
      tone: 'teal',
    },
    {
      label: 'Avg talk time',
      value: formatDuration(kpis.avgTalkSec),
      sub: `${formatDuration(kpis.totalTalkSec)} total`,
    },
    {
      label: 'Sales',
      value: kpis.salesCount.toLocaleString(),
      sub: formatPct(kpis.salesRate) + ' close rate',
      tone: 'amber',
    },
    {
      label: 'Voicemails',
      value: kpis.voicemailCount.toLocaleString(),
    },
    {
      label: 'Callbacks scheduled',
      value: kpis.callbackCount.toLocaleString(),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-2xl border border-line bg-surface p-4"
        >
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
            {t.label}
          </p>
          <p
            className={`mt-1 text-[20px] font-semibold ${
              t.tone === 'teal'
                ? 'text-teal'
                : t.tone === 'amber'
                  ? 'text-amber-500'
                  : 'text-txt-1'
            }`}
          >
            {t.value}
          </p>
          {t.sub && (
            <p className="mt-0.5 text-[11px] text-txt-3">{t.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function AgentTable({ rows }: { rows: AgentRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line-2 bg-surface p-8 text-center text-[12px] text-txt-3">
        No agent activity in this range.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-canvas px-5 py-3">
        <h3 className="text-[13.5px] font-semibold">Per-agent breakdown</h3>
        <p className="text-[11.5px] text-txt-3">
          Sorted by call volume. Avg talk time is the average over connected
          calls.
        </p>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-canvas/50 text-left text-[10.5px] uppercase tracking-wide text-txt-3">
            <th className="px-5 py-2 font-semibold">Agent</th>
            <th className="px-5 py-2 text-right font-semibold">Calls</th>
            <th className="px-5 py-2 text-right font-semibold">Connects</th>
            <th className="px-5 py-2 text-right font-semibold">Connect %</th>
            <th className="px-5 py-2 text-right font-semibold">Avg talk</th>
            <th className="px-5 py-2 text-right font-semibold">Sales</th>
            <th className="px-5 py-2 text-right font-semibold">Close %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.memberId}
              className="border-b border-line last:border-b-0 hover:bg-canvas/40"
            >
              <td className="px-5 py-2">
                <div className="font-medium">{r.name}</div>
                {r.email && r.email !== r.name && (
                  <div className="text-[11px] text-txt-3">{r.email}</div>
                )}
              </td>
              <td className="px-5 py-2 text-right tabular-nums">
                {r.calls.toLocaleString()}
              </td>
              <td className="px-5 py-2 text-right tabular-nums">
                {r.connects.toLocaleString()}
              </td>
              <td className="px-5 py-2 text-right tabular-nums text-txt-2">
                {formatPct(r.connectRate)}
              </td>
              <td className="px-5 py-2 text-right tabular-nums text-txt-2">
                {formatDuration(r.avgTalkSec)}
              </td>
              <td className="px-5 py-2 text-right tabular-nums">
                {r.sales.toLocaleString()}
              </td>
              <td className="px-5 py-2 text-right tabular-nums text-txt-2">
                {formatPct(r.salesRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DispositionBars({ rows }: { rows: DispositionRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line-2 bg-surface p-8 text-center text-[12px] text-txt-3">
        No dispositioned calls in this range.
      </div>
    );
  }
  const max = rows[0]?.count ?? 1;
  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-canvas px-5 py-3">
        <h3 className="text-[13.5px] font-semibold">Disposition mix</h3>
        <p className="text-[11.5px] text-txt-3">
          Share of calls by outcome. Skipped if call has no disposition yet.
        </p>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const pct = max > 0 ? Math.max(2, Math.round((r.count / max) * 100)) : 0;
          const tone = toneFor(r.code);
          return (
            <li key={r.code} className="grid grid-cols-[160px_1fr_120px] items-center gap-4 px-5 py-2">
              <span className="text-[12.5px] font-medium">{dispositionLabel(r.code)}</span>
              <div className="h-2 overflow-hidden rounded-full bg-canvas">
                <div
                  className={`h-full ${tone}`}
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
              </div>
              <span className="text-right text-[12px] tabular-nums text-txt-2">
                {r.count.toLocaleString()} · {formatPct(r.pct)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function toneFor(code: string): string {
  switch (code) {
    case 'sale':
      return 'bg-amber-500';
    case 'connected':
      return 'bg-teal';
    case 'callback':
      return 'bg-sky-500';
    case 'voicemail':
      return 'bg-violet-500';
    case 'do_not_call':
    case 'wrong_number':
    case 'failed':
      return 'bg-rose-500';
    case 'not_interested':
      return 'bg-slate-500';
    default:
      return 'bg-txt-3/60';
  }
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  // Inline-SVG sparkline. Two series: total calls (faded) and connects
  // (foreground teal). 800×120 viewBox; the parent makes it responsive.
  const W = 800;
  const H = 120;
  const PAD = 16;
  if (points.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-8 text-center text-[12px] text-txt-3">
        No trend data.
      </div>
    );
  }
  const max = Math.max(1, ...points.map((p) => p.calls));
  const xStep = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const x = (i: number) => PAD + i * xStep;

  const callsPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.calls)}`).join(' ');
  const callsArea =
    `M${x(0)},${H - PAD} ` +
    points.map((p, i) => `L${x(i)},${y(p.calls)}`).join(' ') +
    ` L${x(points.length - 1)},${H - PAD} Z`;
  const connectsPath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.connects)}`)
    .join(' ');

  const totalCalls = points.reduce((a, p) => a + p.calls, 0);
  const totalConnects = points.reduce((a, p) => a + p.connects, 0);

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line bg-canvas px-5 py-3">
        <div>
          <h3 className="text-[13.5px] font-semibold">Daily trend</h3>
          <p className="text-[11.5px] text-txt-3">
            Calls per day, connects overlay. {points.length} day
            {points.length === 1 ? '' : 's'} shown.
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11.5px]">
          <Legend label="Calls" tone="muted" total={totalCalls} />
          <Legend label="Connects" tone="teal" total={totalConnects} />
        </div>
      </div>
      <div className="px-5 py-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-32 w-full"
          preserveAspectRatio="none"
        >
          <path d={callsArea} className="fill-canvas" />
          <path
            d={callsPath}
            className="stroke-txt-3/60"
            fill="none"
            strokeWidth={1.5}
          />
          <path
            d={connectsPath}
            className="stroke-teal"
            fill="none"
            strokeWidth={1.75}
          />
        </svg>
      </div>
    </div>
  );
}

function Legend({
  label,
  tone,
  total,
}: {
  label: string;
  tone: 'teal' | 'muted';
  total: number;
}) {
  const dotCls = tone === 'teal' ? 'bg-teal' : 'bg-txt-3/60';
  return (
    <span className="inline-flex items-center gap-1.5 text-txt-2">
      <span className={`h-2 w-2 rounded-full ${dotCls}`} aria-hidden />
      <span className="font-medium">{label}</span>
      <span className="text-txt-3">· {total.toLocaleString()}</span>
    </span>
  );
}
