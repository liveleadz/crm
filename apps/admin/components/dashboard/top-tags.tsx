import type { TopTag } from '@/lib/dashboard';

export function TopTags({ tags }: { tags: TopTag[] }) {
  const max = tags.reduce((acc, t) => Math.max(acc, t.count), 0);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-baseline">
        <div>
          <h3 className="text-[14px] font-semibold">Top tags</h3>
          <p className="mt-0.5 text-[11.5px] text-txt-3">
            {tags.length === 0 ? 'No tags applied yet' : `${tags.length} tag${tags.length === 1 ? '' : 's'} in use`}
          </p>
        </div>
      </div>
      {tags.length === 0 ? (
        <p className="py-2 text-[12px] text-txt-3">
          Tag your leads to see the most-used labels here.
        </p>
      ) : (
        <ul className="space-y-2">
          {tags.map((t) => {
            const pct = max > 0 ? (t.count / max) * 100 : 0;
            return (
              <li key={t.id} className="flex items-center gap-3 text-[12px]">
                <span className="flex w-32 shrink-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: t.color ?? 'rgb(var(--teal))' }}
                  />
                  <span className="truncate text-txt-2">{t.name}</span>
                </span>
                <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-canvas">
                  <span
                    className="absolute inset-y-0 left-0 bg-teal/70"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-txt-2">
                  {t.count}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
