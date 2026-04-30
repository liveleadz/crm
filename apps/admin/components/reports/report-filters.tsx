'use client';

// Filter bar for /reports. Mutates URL search params so the server
// component re-fetches with the new range/agent/direction. Mirrors the
// pattern used by /leads' LeadFilters.

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';

type AgentOption = { id: string; name: string };
type RangeKey = '7d' | '30d' | '90d' | 'custom';

const RANGES: { value: RangeKey; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'custom', label: 'Custom' },
];

const DIRECTIONS = [
  { value: 'all', label: 'All' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'outbound', label: 'Outbound' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultFromIso(): string {
  // 30 days ago — matches the default range, gives the picker sensible
  // values the moment a user clicks Custom.
  return new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
}

export function ReportFilters({
  agents,
  initialRange,
  initialAgentId,
  initialDirection,
  initialFromDate,
  initialToDate,
}: {
  agents: AgentOption[];
  initialRange: RangeKey;
  initialAgentId: string;
  initialDirection: 'all' | 'inbound' | 'outbound';
  initialFromDate: string;
  initialToDate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function navigate(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    const href = (qs ? `${pathname}?${qs}` : pathname) as Route;
    startTransition(() => router.replace(href, { scroll: false }));
  }

  function selectRange(next: RangeKey) {
    if (next === 'custom') {
      navigate({
        range: 'custom',
        from: initialFromDate || defaultFromIso(),
        to: initialToDate || todayIso(),
      });
    } else {
      // Drop custom date params when switching off custom so the URL stays clean.
      navigate({ range: next, from: null, to: null });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5">
      <div className="inline-flex rounded-lg border border-line bg-canvas p-0.5">
        {RANGES.map((r) => {
          const on = r.value === initialRange;
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => selectRange(r.value)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                on
                  ? 'bg-surface text-txt-1 shadow-sm'
                  : 'text-txt-3 hover:text-txt-2'
              }`}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {initialRange === 'custom' && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-txt-3">
          <input
            type="date"
            value={initialFromDate}
            max={initialToDate || undefined}
            onChange={(e) => navigate({ from: e.target.value || null })}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-[12px] outline-none focus:border-teal/60"
          />
          <span aria-hidden>→</span>
          <input
            type="date"
            value={initialToDate}
            min={initialFromDate || undefined}
            onChange={(e) => navigate({ to: e.target.value || null })}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-[12px] outline-none focus:border-teal/60"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-[11.5px] text-txt-3">
        <span className="font-medium uppercase tracking-wide">Agent</span>
        <select
          value={initialAgentId}
          onChange={(e) => navigate({ agent: e.target.value || null })}
          className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[12px] outline-none focus:border-teal/60"
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-2 text-[11.5px] text-txt-3">
        <span className="font-medium uppercase tracking-wide">Direction</span>
        <select
          value={initialDirection}
          onChange={(e) =>
            navigate({ dir: e.target.value === 'all' ? null : e.target.value })
          }
          className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[12px] outline-none focus:border-teal/60"
        >
          {DIRECTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
