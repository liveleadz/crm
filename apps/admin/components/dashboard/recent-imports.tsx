import Link from 'next/link';
import type { RecentImport } from '@/lib/dashboard';

function timeAgo(iso: string) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function RecentImports({ imports }: { imports: RecentImport[] }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-baseline">
        <div>
          <h3 className="text-[14px] font-semibold">Recent imports</h3>
          <p className="mt-0.5 text-[11.5px] text-txt-3">
            {imports.length === 0 ? 'No CSV imports yet' : 'Most recent CSV uploads'}
          </p>
        </div>
        <Link
          href="/pipelines/import"
          className="ml-auto h-7 rounded-lg px-2.5 text-[12px] font-medium text-txt-2 hover:bg-surface-2"
        >
          Import →
        </Link>
      </div>
      {imports.length === 0 ? (
        <p className="py-2 text-[12px] text-txt-3">
          Imported lists appear here once you upload a CSV.
        </p>
      ) : (
        <ul className="space-y-1">
          {imports.map((i) => (
            <li key={i.id}>
              <Link
                href={`/leads?list=${i.id}`}
                className="flex items-center gap-3 rounded-xl p-2 text-[12px] hover:bg-surface-2"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal/10 text-teal">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 truncate text-txt-2">{i.name}</span>
                <span className="font-mono text-[11.5px] tabular-nums text-txt-2">
                  {i.count.toLocaleString()}
                </span>
                <span className="w-16 shrink-0 text-right text-[11px] text-txt-3">
                  {timeAgo(i.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
