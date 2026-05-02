'use client';

// Sortable per-member leaderboard. Numbers and percentages flow from
// the server-loaded `Leaderboard` snapshot — clicking a column header
// re-sorts in-process without re-fetching.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Leaderboard, LeaderboardRow } from '@/lib/team-leaderboard';

const PCT = (v: number) => `${(v * 100).toFixed(1)}%`;

function formatTalk(sec: number): string {
  if (!sec || sec <= 0) return '0m';
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

type SortKey =
  | 'name'
  | 'calls'
  | 'connects'
  | 'connectRate'
  | 'talkSec'
  | 'appointments'
  | 'conversionRate';

function compare(a: LeaderboardRow, b: LeaderboardRow, key: SortKey): number {
  if (key === 'name') {
    const an = (a.fullName ?? a.email).toLowerCase();
    const bn = (b.fullName ?? b.email).toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  }
  return (b[key] as number) - (a[key] as number);
}

export function TeamLeaderboard({ data }: { data: Leaderboard }) {
  const [sort, setSort] = useState<SortKey>('calls');
  const [showInactive, setShowInactive] = useState(false);

  const rows = useMemo(() => {
    const filtered = showInactive ? data.rows : data.rows.filter((r) => r.isActive);
    return [...filtered].sort((a, b) => compare(a, b, sort));
  }, [data.rows, sort, showInactive]);

  const t = data.totals;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
          Performance leaderboard
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
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-[11px] uppercase tracking-wide text-txt-3">
              <Th label="Member" sortKey="name" current={sort} onSort={setSort} />
              <Th label="Dials" sortKey="calls" current={sort} onSort={setSort} align="right" />
              <Th
                label="Connects"
                sortKey="connects"
                current={sort}
                onSort={setSort}
                align="right"
              />
              <Th
                label="Connect %"
                sortKey="connectRate"
                current={sort}
                onSort={setSort}
                align="right"
              />
              <Th
                label="Talk"
                sortKey="talkSec"
                current={sort}
                onSort={setSort}
                align="right"
              />
              <Th
                label="Appts"
                sortKey="appointments"
                current={sort}
                onSort={setSort}
                align="right"
              />
              <Th
                label="Conv %"
                sortKey="conversionRate"
                current={sort}
                onSort={setSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[12px] text-txt-3">
                  No members in this window.
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
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/team/${r.memberId}`}
                        className="flex items-center gap-2 hover:text-teal"
                      >
                        <span className="font-medium text-txt-1">
                          {r.fullName ?? r.email.split('@')[0]}
                        </span>
                        <span className="text-[10.5px] text-txt-3">· {r.role}</span>
                      </Link>
                      <div className="text-[11px] text-txt-3">{r.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.calls}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.connects}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-txt-2">
                      {PCT(r.connectRate)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-txt-2">
                      {formatTalk(r.talkSec)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {r.appointments}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-txt-2">
                      {PCT(r.conversionRate)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-line bg-canvas text-[11.5px] font-semibold text-txt-2">
                <td className="px-4 py-2.5">Team total</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.calls}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{t.connects}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {PCT(t.connectRate)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatTalk(t.talkSec)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {t.appointments}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {PCT(t.conversionRate)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Th({
  label,
  sortKey,
  current,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = current === sortKey;
  return (
    <th
      className={`px-4 py-2 font-semibold ${align === 'right' ? 'text-right' : ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-txt-1 ${
          active ? 'text-txt-1' : ''
        }`}
      >
        {label}
        {active && <span className="text-[9px]">▼</span>}
      </button>
    </th>
  );
}
