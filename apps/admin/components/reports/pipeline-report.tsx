// Pipeline report card — current snapshot funnel + per-stage table.
import type { PipelineReport } from '@/lib/reports';
import { formatPct } from '@/lib/reports';

export function PipelineReportView({ report }: { report: PipelineReport }) {
  const { stages, totalLeads } = report;
  const tiles: Array<{ label: string; value: string }> = [
    { label: 'Total leads', value: totalLeads.toLocaleString() },
    {
      label: 'Won',
      value: stages.filter((s) => s.isWon).reduce((sum, s) => sum + s.count, 0).toLocaleString(),
    },
    {
      label: 'Lost',
      value: stages.filter((s) => s.isLost).reduce((sum, s) => sum + s.count, 0).toLocaleString(),
    },
    {
      label: 'In progress',
      value: stages
        .filter((s) => !s.isWon && !s.isLost)
        .reduce((sum, s) => sum + s.count, 0)
        .toLocaleString(),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">{t.label}</p>
            <p className="mt-1 text-[20px] font-semibold">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-surface">
        <div className="border-b border-line bg-canvas px-5 py-3">
          <h3 className="text-[13.5px] font-semibold">Funnel</h3>
          <p className="text-[11.5px] text-txt-3">
            Leads currently in each stage. Conversion shown to the next stage by position.
          </p>
        </div>
        {stages.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-txt-3">
            No stages defined yet.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {stages.map((s) => {
              const tone = s.isWon
                ? 'bg-emerald-500'
                : s.isLost
                  ? 'bg-hp'
                  : 'bg-teal';
              const widthPct = Math.max(2, Math.round(s.pctOfTop * 100));
              return (
                <li key={s.stageId} className="grid grid-cols-[180px_1fr_280px] items-center gap-4 px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[12.5px] font-medium">{s.name}</span>
                    {s.isWon && (
                      <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        Won
                      </span>
                    )}
                    {s.isLost && (
                      <span className="rounded-full bg-hp/10 px-1.5 py-0.5 text-[10px] font-medium text-hp">
                        Lost
                      </span>
                    )}
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-canvas">
                    <div className={`h-full ${tone}`} style={{ width: `${widthPct}%` }} aria-hidden />
                  </div>
                  <div className="flex flex-col items-end gap-0.5 tabular-nums">
                    <div className="flex items-center gap-3 text-[12px]">
                      <span className="font-medium">{s.count.toLocaleString()}</span>
                      <span className="text-txt-3">{formatPct(s.pctOfTop)} of top</span>
                      {s.conversion !== null && (
                        <span className="text-txt-3" title="Conversion to next stage">
                          → {formatPct(s.conversion)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[10.5px] text-txt-3">
                      <span title="Leads that entered this stage in range">
                        +{s.entered.toLocaleString()} in
                      </span>
                      <span title="Leads that left this stage in range">
                        −{s.exited.toLocaleString()} out
                      </span>
                      {s.avgDaysInStage !== null && (
                        <span title="Average dwell time for stints completed in range">
                          {s.avgDaysInStage}d avg
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
