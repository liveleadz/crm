'use client';

// Tab strip for the reports page. Preserves all other search params
// (range, agent, direction, custom dates) so switching tabs doesn't
// reset the user's filter selection.

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';

export type ReportTab =
  | 'calls'
  | 'email'
  | 'pipeline'
  | 'appointments'
  | 'sms'
  | 'campaigns';

const TABS: { value: ReportTab; label: string }[] = [
  { value: 'calls', label: 'Calls' },
  { value: 'email', label: 'Email' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'appointments', label: 'Appointments' },
  { value: 'sms', label: 'SMS' },
  { value: 'campaigns', label: 'Campaigns' },
];

export function ReportTabs({ current }: { current: ReportTab }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  function go(next: ReportTab) {
    if (next === current) return;
    const qs = new URLSearchParams(params.toString());
    if (next === 'calls') qs.delete('tab');
    else qs.set('tab', next);
    const search = qs.toString();
    const href = (search ? `${pathname}?${search}` : pathname) as Route;
    startTransition(() => router.replace(href, { scroll: false }));
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface p-1">
      {TABS.map((t) => {
        const on = t.value === current;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => go(t.value)}
            className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
              on
                ? 'bg-canvas text-txt-1 shadow-sm'
                : 'text-txt-3 hover:text-txt-1'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
