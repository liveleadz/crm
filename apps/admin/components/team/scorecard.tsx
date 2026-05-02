// Per-rep scorecard: KPI tiles for today/week/month, a 14-day dial
// sparkline, and a per-campaign breakdown table. Pure presentational —
// the data layer in `lib/scorecard.ts` does all aggregation.

import Link from 'next/link';
import type { Scorecard as ScorecardData, ScorecardWindow } from '@/lib/scorecard';

const PCT = (v: number) => `${(v * 100).toFixed(1)}%`;

function formatTalk(sec: number): string {
  if (!sec || sec <= 0) return '0m';
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function shortDate(key: string): string {
  // YYYY-MM-DD → Mon DD
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function Scorecard({
  data,
  brandTimezone,
}: {
  data: ScorecardData;
  brandTimezone: string;
}) {
  return (
    <div className="space-y-5">
      <WindowGrid title="Today" w={data.today} />
      <WindowGrid title="Last 7 days" w={data.week} />
      <WindowGrid title="Last 30 days" w={data.month} />
      <Sparkline points={data.sparkline} />
      <CampaignTable rows={data.byCampaign} />
      <div className="text-[10.5px] text-txt-3">
        Windows are anchored to {brandTimezone}.
      </div>
    </div>
  );
}

function WindowGrid({ title, w }: { title: string; w: ScorecardWindow }) {
  return (
    <section className="space-y-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Dials" value={w.calls.toLocaleString()} />
        <Tile label="Connects" value={w.connects.toLocaleString()} />
        <Tile label="Connect rate" value={PCT(w.connectRate)} />
        <Tile label="Talk time" value={formatTalk(w.talkSec)} />
        <Tile label="Appointments" value={w.appointments.toLocaleString()} />
        <Tile label="Conversion" value={PCT(w.conversionRate)} />
      </div>
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-txt-3">
        {label}
      </div>
      <div className="mt-1 text-[18px] font-semibold tabular-nums text-txt-1">
        {value}
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: ScorecardData['sparkline'] }) {
  const max = Math.max(1, ...points.map((p) => p.calls));
  return (
    <section className="space-y-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
        Last 14 days · dials
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-end gap-1.5">
          {points.map((p) => {
            const h = Math.round((p.calls / max) * 64);
            const ch = Math.round((p.connects / max) * 64);
            return (
              <div key={p.date} className="flex flex-1 flex-col items-center gap-1">
                <div className="relative flex h-[68px] w-full items-end justify-center">
                  <div
                    className="w-full rounded-sm bg-line-2"
                    style={{ height: `${Math.max(2, h)}px` }}
                    title={`${p.calls} dial${p.calls === 1 ? '' : 's'}`}
                  />
                  {p.connects > 0 && (
                    <div
                      className="absolute bottom-0 w-full rounded-sm bg-teal/70"
                      style={{ height: `${Math.max(2, ch)}px` }}
                      title={`${p.connects} connect${p.connects === 1 ? '' : 's'}`}
                    />
                  )}
                </div>
                <div className="text-[9.5px] tabular-nums text-txt-3">
                  {shortDate(p.date)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-3 text-[10.5px] text-txt-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-line-2" />
            Dials
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-teal/70" />
            Connects
          </span>
        </div>
      </div>
    </section>
  );
}

function CampaignTable({ rows }: { rows: ScorecardData['byCampaign'] }) {
  return (
    <section className="space-y-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
        Per campaign · last 30 days
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center text-[12px] text-txt-3">
          No campaign activity in the last 30 days.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-canvas text-left text-[11px] uppercase tracking-wide text-txt-3">
                <th className="px-4 py-2 font-semibold">Campaign</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">Dials</th>
                <th className="px-4 py-2 text-right font-semibold">Connects</th>
                <th className="px-4 py-2 text-right font-semibold">Connect %</th>
                <th className="px-4 py-2 text-right font-semibold">Appts</th>
                <th className="px-4 py-2 text-right font-semibold">Conv %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const connectRate = r.calls > 0 ? r.connects / r.calls : 0;
                const convRate = r.calls > 0 ? r.appointments / r.calls : 0;
                return (
                  <tr
                    key={r.campaignId}
                    className="border-b border-line last:border-b-0 hover:bg-canvas/40"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/campaigns/${r.campaignId}`}
                        className="font-medium text-txt-1 hover:text-teal"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-[11.5px] text-txt-3">{r.status}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.calls}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.connects}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-txt-2">
                      {PCT(connectRate)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.appointments}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-txt-2">
                      {PCT(convRate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
