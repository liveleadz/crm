'use client';

// Phase N: compact "Live team" widget pinned above the sidebar footer.
// Reads `member_presence` directly from the browser client (RLS scopes
// it to the active brand) and subscribes to postgres_changes so counts
// update the instant the DB row flips.
//
// Status of rows older than STALE_MS is treated as 'offline' regardless
// of their stored value, mirroring the server-side helper. Otherwise a
// crashed tab would inflate "active" counts forever. To keep the dots
// flipping into 'offline' the moment the staleness clock crosses, we
// re-tally locally every few seconds against cached rows — no extra
// DB round-trips beyond the Realtime stream.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { createBrowserClient } from '@leadpilot/db/client';

const STALE_MS = 3 * 60 * 1000;
// Local re-tally cadence. Cheap: pure arithmetic over a few cached rows.
const TICK_MS = 3 * 1000;
// Safety-net DB resync. Realtime + local tick cover the common case;
// this catches any missed Realtime events (channel drop, brief
// disconnect) without making the widget feel laggy.
const RESYNC_MS = 60 * 1000;

type PresenceRow = { status: string | null; last_event_at: string | null };
type Counts = { onCall: number; active: number; idle: number; offline: number };

function effectiveStatus(raw: string | null, lastEventAt: string | null): keyof Counts {
  if (!lastEventAt) return 'offline';
  if (Date.now() - new Date(lastEventAt).getTime() > STALE_MS) return 'offline';
  if (raw === 'on_call') return 'onCall';
  if (raw === 'active') return 'active';
  if (raw === 'idle') return 'idle';
  return 'offline';
}

function tally(rows: PresenceRow[]): Counts {
  const next: Counts = { onCall: 0, active: 0, idle: 0, offline: 0 };
  for (const r of rows) next[effectiveStatus(r.status, r.last_event_at)] += 1;
  return next;
}

export function LiveTeamWidget({ brandId }: { brandId: string }) {
  const [rows, setRows] = useState<PresenceRow[]>([]);
  // Drives a re-render every TICK_MS so `effectiveStatus` re-evaluates
  // against a fresh `Date.now()`. The actual rows array can stay stable
  // — only the staleness verdict changes as wall-clock advances.
  const [, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = createBrowserClient();
    let mounted = true;

    async function resync() {
      const { data } = await supabase
        .from('member_presence')
        .select('status, last_event_at')
        .eq('brand_id', brandId);
      if (!mounted) return;
      setRows(data ?? []);
    }

    void resync();
    const localTick = setInterval(() => setNow(Date.now()), TICK_MS);
    const safetyResync = setInterval(() => void resync(), RESYNC_MS);

    const channel = supabase
      .channel(`presence:${brandId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_presence', filter: `brand_id=eq.${brandId}` },
        () => void resync(),
      )
      .subscribe();

    return () => {
      mounted = false;
      clearInterval(localTick);
      clearInterval(safetyResync);
      void supabase.removeChannel(channel);
    };
  }, [brandId]);

  // Recomputed on every render — cheap, and the local tick + Realtime
  // events guarantee the component re-renders frequently enough that
  // the dots track wall-clock staleness.
  const counts = tally(rows);

  return (
    <Link
      href={'/team' as Route}
      className="flex items-center gap-2 rounded-lg border border-line bg-canvas/40 px-2.5 py-2 text-[11.5px] text-txt-2 hover:bg-canvas"
      title={`${counts.onCall} on call · ${counts.active} active · ${counts.idle} idle · ${counts.offline} offline`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-txt-3">Live team</span>
      <span className="ml-auto flex items-center gap-2">
        <Dot color="bg-hp" count={counts.onCall} />
        <Dot color="bg-teal" count={counts.active} />
        <Dot color="bg-amber-500" count={counts.idle} />
      </span>
    </Link>
  );
}

function Dot({ color, count }: { color: string; count: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span className="tabular-nums">{count}</span>
    </span>
  );
}
