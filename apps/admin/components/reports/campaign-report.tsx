// Campaign report card — KPI strip + per-campaign table sorted by call
// volume. Mirrors the appointments-report styling.
import type { CampaignReport } from '@/lib/reports';
import { formatPct } from '@/lib/reports';

export function CampaignReportView({ report }: { report: CampaignReport }) {
  const { rows, totals } = report;
  const tiles: Array<{ label: string; value: string; sub?: string; tone?: 'teal' | 'amber' | 'hp' }> = [
    { label: 'Calls', value: totals.calls.toLocaleString() },
    { label: 'Connects', value: totals.connects.toLocaleString(), tone: 'teal' },
    {
      label: 'Connect %',
      value: formatPct(totals.connectRate),
      sub: 'connects / calls',
      tone: 'amber',
    },
    { label: 'Appointments', value: totals.appointmentsBooked.toLocaleString() },
    {
      label: 'Show %',
      value: formatPct(totals.showRate),
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

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line-2 bg-surface p-8 text-center text-[12px] text-txt-3">
          No campaign activity in this range.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line bg-canvas px-5 py-3">
            <h3 className="text-[13.5px] font-semibold">Per-campaign breakdown</h3>
            <p className="text-[11.5px] text-txt-3">
              Sorted by call volume. Show rate excludes cancelled.
            </p>
          </div>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-canvas/50 text-left text-[10.5px] uppercase tracking-wide text-txt-3">
                <th className="px-5 py-2 font-semibold">Campaign</th>
                <th className="px-5 py-2 text-right font-semibold">Calls</th>
                <th className="px-5 py-2 text-right font-semibold">Connects</th>
                <th className="px-5 py-2 text-right font-semibold">Connect %</th>
                <th className="px-5 py-2 text-right font-semibold">Appointments</th>
                <th className="px-5 py-2 text-right font-semibold">Show %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.campaignId} className="border-b border-line last:border-b-0 hover:bg-canvas/40">
                  <td className="px-5 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.status !== 'active' && (
                      <div className="text-[11px] text-txt-3 capitalize">{r.status}</div>
                    )}
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.calls.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.connects.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right tabular-nums text-txt-2">{formatPct(r.connectRate)}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{r.appointmentsBooked.toLocaleString()}</td>
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
