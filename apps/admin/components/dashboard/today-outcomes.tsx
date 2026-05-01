import Link from 'next/link';
import type { TodayOutcome } from '@/lib/dashboard';

const TONE_BAR: Record<TodayOutcome['tone'], string> = {
  good: 'bg-teal',
  neutral: 'bg-txt-3/50',
  bad: 'bg-hp',
};

const TONE_DOT: Record<TodayOutcome['tone'], string> = {
  good: 'bg-teal',
  neutral: 'bg-txt-3/60',
  bad: 'bg-hp',
};

export function TodayOutcomes({ outcomes }: { outcomes: TodayOutcome[] }) {
  const total = outcomes.reduce((acc, o) => acc + o.count, 0);
  const max = outcomes.reduce((acc, o) => Math.max(acc, o.count), 0);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-baseline">
        <div>
          <h3 className="text-[14px] font-semibold">Today's outcomes</h3>
          <p className="mt-0.5 text-[11.5px] text-txt-3">
            {total === 0
              ? 'No dispositioned calls yet today'
              : `${total} call${total === 1 ? '' : 's'} dispositioned`}
          </p>
        </div>
        <Link
          href="/calls"
          className="ml-auto h-7 rounded-lg px-2.5 text-[12px] font-medium text-txt-2 hover:bg-surface-2"
        >
          All →
        </Link>
      </div>
      {outcomes.length === 0 ? (
        <p className="py-2 text-[12px] text-txt-3">
          Outcomes appear here as agents disposition their calls.
        </p>
      ) : (
        <ul className="space-y-2">
          {outcomes.map((o) => {
            const pct = max > 0 ? (o.count / max) * 100 : 0;
            return (
              <li key={o.code} className="flex items-center gap-3 text-[12px]">
                <span className="flex w-32 shrink-0 items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[o.tone]}`} />
                  <span className="truncate text-txt-2">{o.label}</span>
                </span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-canvas">
                  <span
                    className={`absolute inset-y-0 left-0 ${TONE_BAR[o.tone]}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-txt-2">
                  {o.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
