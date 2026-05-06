'use client';

// Phase O: live grid of in-progress calls. Server seeds the initial
// list; this component subscribes to postgres_changes on the `calls`
// table for the brand and re-fetches the snapshot whenever a row
// inserts / updates / leaves the active set.
//
// Elapsed timers tick locally each second so the cards feel alive
// without the server having to push every second.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { createBrowserClient } from '@leadpilot/db/client';
import type { ActiveCall } from '@/lib/live-floor';
import { LivePulseDot } from './live-pulse-dot';

export function ActiveCallsGrid({
  brandId,
  initial,
}: {
  brandId: string;
  initial: ActiveCall[];
}) {
  const [calls, setCalls] = useState<ActiveCall[]>(initial);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel(`active-calls:${brandId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls', filter: `brand_id=eq.${brandId}` },
        async () => {
          // Refetch the lightweight active set rather than diff-merging.
          // Volume of in-progress calls is bounded (≤ team size) so the
          // round-trip is cheap and keeps the join data fresh.
          const res = await fetch(`/api/live/active-calls`, { cache: 'no-store' });
          if (!res.ok) return;
          const data: ActiveCall[] = await res.json();
          setCalls(data);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [brandId]);

  if (calls.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center text-[12.5px] text-txt-3">
        No active calls right now.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {calls.map((c) => {
        // Cap at the 2h floor horizon — anything beyond is a stale row
        // that the janitor cron hasn't closed yet; never render a wall-
        // clock that reads in the thousands of minutes.
        const ACTIVE_CAP_SEC = 2 * 60 * 60;
        const rawElapsed = Math.max(0, Math.floor((now - new Date(c.startedAt).getTime()) / 1000));
        const elapsed = Math.min(rawElapsed, ACTIVE_CAP_SEC);
        const hours = Math.floor(elapsed / 3600);
        const mins = Math.floor((elapsed % 3600) / 60);
        const secs = elapsed % 60;
        const elapsedLabel =
          hours > 0
            ? `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
            : `${mins}:${secs.toString().padStart(2, '0')}`;
        const card = (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <LivePulseDot active />
              <span className="text-[11px] font-medium uppercase tracking-wide text-hp">
                {c.direction === 'inbound' ? 'Inbound' : 'Outbound'}
              </span>
              <span className="ml-auto font-mono text-[12px] tabular-nums text-txt-2">
                {elapsedLabel}
              </span>
            </div>
            <div className="text-[14px] font-medium">
              {c.leadName ?? c.toNumber}
            </div>
            <div className="text-[12px] text-txt-2">
              {[c.leadCity, c.leadState].filter(Boolean).join(', ') || c.toNumber}
            </div>
            <div className="mt-1 flex items-center gap-2 border-t border-line pt-2 text-[11.5px] text-txt-3">
              <span>{c.memberName ?? 'Unassigned'}</span>
              {c.campaignName && (
                <span className="ml-auto rounded-full border border-line bg-canvas px-2 py-0.5 text-[10.5px]">
                  {c.campaignName}
                </span>
              )}
            </div>
          </div>
        );
        return c.leadId ? (
          <Link
            key={c.callId}
            href={`/leads/${c.leadId}` as Route}
            target="_blank"
            className="block transition-transform hover:-translate-y-0.5"
          >
            {card}
          </Link>
        ) : (
          <div key={c.callId}>{card}</div>
        );
      })}
    </div>
  );
}
