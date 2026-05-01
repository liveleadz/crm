// SMS report card — KPI strip + daily trend. Sourced from message_outbox.
import type { SmsReport } from '@/lib/reports';
import { TrendDual } from './email-report';

export function SmsReportView({ report }: { report: SmsReport }) {
  const { kpis, trend } = report;
  const tiles: Array<{ label: string; value: string; tone?: 'teal' | 'hp' | 'amber' }> = [
    { label: 'Sent', value: kpis.sent.toLocaleString() },
    { label: 'Delivered', value: kpis.delivered.toLocaleString(), tone: 'teal' },
    { label: 'Failed', value: kpis.failed.toLocaleString(), tone: 'hp' },
    { label: 'Pending', value: kpis.pending.toLocaleString(), tone: 'amber' },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">{t.label}</p>
            <p
              className={`mt-1 text-[20px] font-semibold ${
                t.tone === 'teal'
                  ? 'text-teal'
                  : t.tone === 'hp'
                    ? 'text-hp'
                    : t.tone === 'amber'
                      ? 'text-amber-500'
                      : 'text-txt-1'
              }`}
            >
              {t.value}
            </p>
          </div>
        ))}
      </div>

      <TrendDual
        title="SMS volume"
        subtitle="Daily sent / delivered (queued from automations and manual sends)."
        points={trend.map((p) => ({ date: p.date, a: p.sent, b: p.delivered }))}
        labelA="Sent"
        labelB="Delivered"
      />

      {kpis.sent === 0 && kpis.failed === 0 && kpis.pending === 0 && (
        <div className="rounded-2xl border border-dashed border-line-2 bg-surface p-8 text-center text-[12px] text-txt-3">
          No SMS activity in this range.
        </div>
      )}
    </div>
  );
}
