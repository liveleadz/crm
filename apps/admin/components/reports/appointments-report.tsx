// Appointments report card — KPI strip, daily trend, per-closer table.
import type { AppointmentsReport } from '@/lib/reports';
import { formatPct } from '@/lib/reports';
import { TrendDual } from './email-report';

export function AppointmentsReportView({ report }: { report: AppointmentsReport }) {
  const { kpis, perCloser, trend } = report;
  const tiles: Array<{ label: string; value: string; sub?: string; tone?: 'teal' | 'amber' | 'hp' }> = [
    { label: 'Booked', value: kpis.booked.toLocaleString() },
    { label: 'Showed', value: kpis.showed.toLocaleString(), tone: 'teal' },
    { label: 'No-show', value: kpis.noShowed.toLocaleString(), tone: 'hp' },
    { label: 'Cancelled', value: kpis.cancelled.toLocaleString() },
    {
      label: 'Show rate',
      value: formatPct(kpis.showRate),
      sub: 'showed / (showed + no-show)',
      tone: 'amber',
    },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">{t.label}</p>
            <p
              className={`mt-1 text-[20px] font-semibold ${
                t.tone === 'teal'
                  ? 'text-teal'
                  : t.tone === 'amber'
                    ? 'text-amber-500'
                    : t.tone === 'hp'
                      ? 'text-hp'
                      : 'text-txt-1'
              }`}
            >
              {t.value}
            </p>
            {t.sub && <p className="mt-0.5 text-[11px] text-txt-3">{t.sub}</p>}
          </div>
        ))}
      </div>

      <TrendDual
        title="Appointments"
        subtitle="Daily booked / showed by start time."
        points={trend.map((p) => ({ date: p.date, a: p.booked, b: p.showed }))}
        labelA="Booked"
        labelB="Showed"
      />

      {perCloser.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-2 bg-surface p-8 text-center text-[12px] text-txt-3">
          No appointments in this range.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line bg-canvas px-5 py-3">
            <h3 className="text-[13.5px] font-semibold">Per-closer breakdown</h3>
            <p className="text-[11.5px] text-txt-3">
              Grouped by the appointment owner. Show rate excludes cancelled.
            </p>
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-canvas/50 text-left text-[10.5px] uppercase tracking-wide text-txt-3">
                <th className="px-5 py-2 font-semibold">Closer</th>
                <th className="px-5 py-2 text-right font-semibold">Booked</th>
                <th className="px-5 py-2 text-right font-semibold">Showed</th>
                <th className="px-5 py-2 text-right font-semibold">No-show</th>
                <th className="px-5 py-2 text-right font-semibold">Cancelled</th>
                <th className="px-5 py-2 text-right font-semibold">Show %</th>
              </tr>
            </thead>
            <tbody>
              {perCloser.map((r) => (
                <tr key={r.memberId} className="border-b border-line last:border-b-0 hover:bg-canvas/40">
                  <td className="px-5 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.email && r.email !== r.name && (
                      <div className="text-[11px] text-txt-3">{r.email}</div>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.booked.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.showed.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.noShowed.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.cancelled.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-txt-2">{formatPct(r.showRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
