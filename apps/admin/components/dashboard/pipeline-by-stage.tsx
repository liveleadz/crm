import type { PipelineSlice } from '@/lib/dashboard';

// Stage color → tailwind class (RGB triples in tailwind preset).
// Stage colors are stored as the brand-token name; default to teal.
const COLOR_CLASSES: Record<string, { bg: string; text: string }> = {
  teal: { bg: 'bg-teal', text: 'text-teal' },
  hp: { bg: 'bg-hp', text: 'text-hp' },
  vl: { bg: 'bg-vl', text: 'text-vl' },
  bs: { bg: 'bg-bs', text: 'text-bs' },
  ll: { bg: 'bg-ll', text: 'text-ll' },
  hb: { bg: 'bg-hb', text: 'text-hb' },
  bi: { bg: 'bg-bi', text: 'text-bi' },
};

function classFor(color: string | null) {
  if (color && COLOR_CLASSES[color]) return COLOR_CLASSES[color]!;
  return { bg: 'bg-txt-3/40', text: 'text-txt-3' };
}

export function PipelineByStage({ pipeline }: { pipeline: PipelineSlice[] }) {
  const total = pipeline.reduce((acc, p) => acc + p.count, 0);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-center">
        <div>
          <h3 className="text-[14px] font-semibold">Pipeline by stage</h3>
          <p className="mt-0.5 text-[11.5px] text-txt-3">Auto-managed · updates in real-time</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-txt-3">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ll" />
          Live
        </div>
      </div>

      {total === 0 ? (
        <div className="grid h-3 grid-cols-1 overflow-hidden rounded-full bg-surface-2" />
      ) : (
        <div className="mb-4 flex h-3 gap-[2px] overflow-hidden rounded-full">
          {pipeline.map((p) => {
            const pct = (p.count / total) * 100;
            if (pct === 0) return null;
            return <div key={p.id} className={classFor(p.color).bg} style={{ width: `${pct}%` }} />;
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-[11.5px] sm:grid-cols-3 lg:grid-cols-5">
        {pipeline.length === 0 ? (
          <p className="col-span-full text-[12.5px] text-txt-3">
            No stages configured for this brand.
          </p>
        ) : (
          pipeline.map((p) => {
            const cls = classFor(p.color);
            return (
              <div key={p.id}>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-sm ${cls.bg}`} />
                  <span className="text-txt-2">{p.name}</span>
                </div>
                <div className="mt-1 font-mono text-[14px] font-medium">{p.count}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
