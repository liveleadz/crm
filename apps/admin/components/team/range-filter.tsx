'use client';

// Range filter pill row used by both the team leaderboard and the
// per-rep scorecard. Driven entirely by URL query params so the page
// stays a server component and refreshes its data on each pick.

import type { Route } from 'next';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import type { RollingRange } from '@/lib/datetime';

const PRESETS: { value: RollingRange; label: string }[] = [
  { value: '1d', label: 'Today' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'custom', label: 'Custom' },
];

export function RangeFilter({
  current,
  fromIso,
  toIso,
}: {
  current: RollingRange;
  fromIso: string | null;
  toIso: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function setRange(next: RollingRange) {
    const sp = new URLSearchParams(params.toString());
    sp.set('range', next);
    if (next !== 'custom') {
      sp.delete('from');
      sp.delete('to');
    }
    startTransition(() => router.push(`${pathname}?${sp.toString()}` as Route));
  }

  function setCustom(which: 'from' | 'to', value: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set('range', 'custom');
    if (value) sp.set(which, value);
    else sp.delete(which);
    startTransition(() => router.push(`${pathname}?${sp.toString()}` as Route));
  }

  const fromInput = fromIso ? toLocalDate(fromIso) : '';
  const toInput = toIso ? toLocalDate(toIso) : '';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-0.5">
        {PRESETS.map((p) => {
          const active = p.value === current;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => setRange(p.value)}
              disabled={pending}
              className={`rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors ${
                active
                  ? 'bg-teal text-white'
                  : 'text-txt-2 hover:bg-canvas hover:text-txt-1'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {current === 'custom' && (
        <div className="inline-flex items-center gap-1.5">
          <input
            type="date"
            value={fromInput}
            onChange={(e) => setCustom('from', e.target.value)}
            className="rounded-lg border border-line bg-canvas px-2 py-1 text-[12px] outline-none focus:border-teal/60"
          />
          <span className="text-[11px] text-txt-3">→</span>
          <input
            type="date"
            value={toInput}
            onChange={(e) => setCustom('to', e.target.value)}
            className="rounded-lg border border-line bg-canvas px-2 py-1 text-[12px] outline-none focus:border-teal/60"
          />
        </div>
      )}
    </div>
  );
}

// ISO instant → "YYYY-MM-DD" using the browser's local clock so the
// <input type="date"> displays the same day the user picked.
function toLocalDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
