// Email report card — KPI strip, daily trend, per-agent table.
import type { EmailReport } from '@/lib/reports';
import { formatPct } from '@/lib/reports';

export function EmailReportView({ report }: { report: EmailReport }) {
  const { kpis, perAgent, trend } = report;
  const tiles: Array<{ label: string; value: string; sub?: string }> = [
    { label: 'Sent', value: kpis.sent.toLocaleString() },
    { label: 'Received', value: kpis.received.toLocaleString() },
    { label: 'Reply rate', value: formatPct(kpis.replyRate) },
    {
      label: 'Avg response',
      value: kpis.avgResponseMin > 0 ? `${kpis.avgResponseMin}m` : '—',
    },
    { label: 'Open threads', value: kpis.threadsOpen.toLocaleString() },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">{t.label}</p>
            <p className="mt-1 text-[20px] font-semibold">{t.value}</p>
            {t.sub && <p className="mt-0.5 text-[11px] text-txt-3">{t.sub}</p>}
          </div>
        ))}
      </div>

      <TrendDual
        title="Email volume"
        subtitle="Daily sent / received in your local timezone."
        points={trend.map((p) => ({ date: p.date, a: p.sent, b: p.received }))}
        labelA="Sent"
        labelB="Received"
      />

      {perAgent.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-2 bg-surface p-8 text-center text-[12px] text-txt-3">
          No email activity in this range.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line bg-canvas px-5 py-3">
            <h3 className="text-[13.5px] font-semibold">Per-agent breakdown</h3>
            <p className="text-[11.5px] text-txt-3">
              Reply rate is replied / sent in the window. Response time only counts replies within 14 days.
            </p>
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-canvas/50 text-left text-[10.5px] uppercase tracking-wide text-txt-3">
                <th className="px-5 py-2 font-semibold">Agent</th>
                <th className="px-5 py-2 text-right font-semibold">Sent</th>
                <th className="px-5 py-2 text-right font-semibold">Received</th>
                <th className="px-5 py-2 text-right font-semibold">Replied</th>
                <th className="px-5 py-2 text-right font-semibold">Reply %</th>
                <th className="px-5 py-2 text-right font-semibold">Avg response</th>
              </tr>
            </thead>
            <tbody>
              {perAgent.map((r) => (
                <tr key={r.memberId} className="border-b border-line last:border-b-0 hover:bg-canvas/40">
                  <td className="px-5 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.email && r.email !== r.name && (
                      <div className="text-[11px] text-txt-3">{r.email}</div>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.sent.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.received.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.replied.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-txt-2">{formatPct(r.replyRate)}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-txt-2">
                    {r.avgResponseMin > 0 ? `${r.avgResponseMin}m` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function TrendDual({
  title,
  subtitle,
  points,
  labelA,
  labelB,
}: {
  title: string;
  subtitle: string;
  points: { date: string; a: number; b: number }[];
  labelA: string;
  labelB: string;
}) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => Math.max(p.a, p.b)));
  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="border-b border-line bg-canvas px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[13.5px] font-semibold">{title}</h3>
            <p className="text-[11.5px] text-txt-3">{subtitle}</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-txt-3">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-teal" /> {labelA}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" /> {labelB}
            </span>
          </div>
        </div>
      </div>
      <div className="px-5 py-4">
        <div className="flex h-32 items-end gap-1">
          {points.map((p) => {
            const ha = max > 0 ? (p.a / max) * 100 : 0;
            const hb = max > 0 ? (p.b / max) * 100 : 0;
            return (
              <div key={p.date} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${p.date}: ${labelA}=${p.a}, ${labelB}=${p.b}`}>
                <div className="flex w-full items-end gap-px">
                  <div
                    className="flex-1 rounded-t bg-teal/70"
                    style={{ height: `${ha}%`, minHeight: p.a > 0 ? '2px' : '0' }}
                  />
                  <div
                    className="flex-1 rounded-t bg-amber-500/70"
                    style={{ height: `${hb}%`, minHeight: p.b > 0 ? '2px' : '0' }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
