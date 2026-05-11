'use client';

// Per-agent disposition breakdown. Sits below the leaderboard on
// /team and gives managers the missing "what kind of outcomes is each
// rep actually getting?" view — every cell shows raw count + share of
// that rep's dispositioned calls in the active window.
//
// Categories are the stable axis (renaming "Connected" → "Closed" in
// settings doesn't shift these numbers); see lib/dispositions-shared.ts.

import { useMemo, useState } from 'react';
import {
  DISPOSITION_CATEGORIES,
  DISPOSITION_CATEGORY_LABELS,
  type DispositionCategory,
} from '@/lib/dispositions-shared';
import type { Leaderboard } from '@/lib/team-leaderboard';

const PCT = (count: number, total: number): string =>
  total > 0 ? `${((count / total) * 100).toFixed(1)}%` : '—';

// Visual hint per category so the manager can scan tone at a glance.
// Matches the palette DispositionBars uses on the reports page.
const CATEGORY_TONE: Record<DispositionCategory, string> = {
  connected: 'text-teal',
  appointment_set: 'text-amber',
  callback: 'text-sky',
  voicemail: 'text-violet',
  no_answer: 'text-txt-2',
  wrong_number: 'text-hp',
  not_interested: 'text-txt-3',
  do_not_call: 'text-hp',
  other: 'text-txt-3',
};

export function TeamDispositionMix({ data }: { data: Leaderboard }) {
  const [showInactive, setShowInactive] = useState(false);

  const rows = useMemo(() => {
    const filtered = showInactive ? data.rows : data.rows.filter((r) => r.isActive);
    // Hide reps with zero dispositioned calls — the row is just nine
    // dashes otherwise. Keeps the manager focused on people with
    // outcomes worth comparing.
    return filtered.filter((r) => r.dispositioned > 0);
  }, [data.rows, showInactive]);

  const t = data.totals;
  const hasData = rows.length > 0 && t.dispositioned > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
          Disposition mix by agent
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[11.5px] text-txt-3">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-line"
          />
          Show inactive
        </label>
      </div>
      <div className="overflow-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-max text-[12px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-[10.5px] uppercase tracking-wide text-txt-3">
              <th className="sticky left-0 z-10 bg-canvas px-4 py-2 text-left font-semibold">
                Member
              </th>
              <th className="px-3 py-2 text-right font-semibold">Total</th>
              {DISPOSITION_CATEGORIES.map((cat) => (
                <th key={cat} className="px-3 py-2 text-right font-semibold">
                  {DISPOSITION_CATEGORY_LABELS[cat]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!hasData ? (
              <tr>
                <td
                  colSpan={2 + DISPOSITION_CATEGORIES.length}
                  className="px-4 py-6 text-center text-[12px] text-txt-3"
                >
                  No dispositioned calls in this window.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const dim = !r.isActive ? 'opacity-60' : '';
                return (
                  <tr
                    key={r.memberId}
                    className={`border-b border-line last:border-b-0 hover:bg-canvas/40 ${dim}`}
                  >
                    <td className="sticky left-0 z-10 bg-surface px-4 py-2.5">
                      <div className="font-medium text-txt-1">
                        {r.fullName ?? r.email.split('@')[0]}
                      </div>
                      <div className="text-[11px] text-txt-3">{r.email}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-txt-2">
                      {r.dispositioned}
                    </td>
                    {DISPOSITION_CATEGORIES.map((cat) => {
                      const count = r.categories[cat] ?? 0;
                      const tone = count > 0 ? CATEGORY_TONE[cat] : 'text-txt-3';
                      return (
                        <td
                          key={cat}
                          className="px-3 py-2.5 text-right tabular-nums"
                        >
                          <div className={`font-medium ${tone}`}>
                            {count}
                          </div>
                          <div className="text-[10.5px] text-txt-3">
                            {PCT(count, r.dispositioned)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
          {hasData && (
            <tfoot>
              <tr className="border-t border-line bg-canvas text-[11.5px] font-semibold text-txt-2">
                <td className="sticky left-0 z-10 bg-canvas px-4 py-2.5">
                  Team total
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {t.dispositioned}
                </td>
                {DISPOSITION_CATEGORIES.map((cat) => {
                  const count = t.categories[cat] ?? 0;
                  return (
                    <td key={cat} className="px-3 py-2.5 text-right tabular-nums">
                      <div>{count}</div>
                      <div className="text-[10.5px] font-normal text-txt-3">
                        {PCT(count, t.dispositioned)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
