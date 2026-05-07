'use client';

// Phase N: compact "Live team" widget pinned above the sidebar footer.
//
// Counts every active member of the brand — pulled from `brand_members`
// — bucketed by their `member_presence` row (or "offline" if no row /
// last event > STALE_MS). This is important: an invited member who
// hasn't signed in yet has no presence row, but they're still part of
// the team and should be visible as offline.
//
// Realtime subscriptions cover live status flips; a 3s local re-tally
// keeps the staleness clock honest without DB load; a 60s safety
// resync catches missed Realtime events and roster changes.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { createBrowserClient } from '@leadpilot/db/client';

const STALE_MS = 3 * 60 * 1000;
// Local re-tally cadence. Cheap: pure arithmetic over a few cached rows.
const TICK_MS = 3 * 1000;
// Safety-net DB resync. Realtime + local tick cover the common case;
// this catches any missed Realtime events (channel drop, brief
// disconnect) and any roster changes (invite / remove).
const RESYNC_MS = 60 * 1000;

type PresenceRow = { member_id: string; status: string | null; last_event_at: string | null };
type Bucket = 'onCall' | 'active' | 'idle' | 'offline';
type Counts = Record<Bucket, number>;

function bucketFor(row: PresenceRow | undefined): Bucket {
  if (!row || !row.last_event_at) return 'offline';
  if (Date.now() - new Date(row.last_event_at).getTime() > STALE_MS) return 'offline';
  if (row.status === 'on_call') return 'onCall';
  if (row.status === 'active') return 'active';
  if (row.status === 'idle') return 'idle';
  return 'offline';
}

function tally(memberIds: string[], presenceByMember: Map<string, PresenceRow>): Counts {
  const next: Counts = { onCall: 0, active: 0, idle: 0, offline: 0 };
  for (const id of memberIds) next[bucketFor(presenceByMember.get(id))] += 1;
  return next;
}

export function LiveTeamWidget({ brandId }: { brandId: string }) {
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [presence, setPresence] = useState<Map<string, PresenceRow>>(new Map());
  // Drives a re-render every TICK_MS so `bucketFor` re-evaluates against
  // a fresh `Date.now()`. The cached data can stay stable — only the
  // staleness verdict changes as wall-clock advances.
  const [, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = createBrowserClient();
    let mounted = true;

    async function resyncRoster() {
      const { data } = await supabase
        .from('brand_members')
        .select('member_id')
        .eq('brand_id', brandId)
        .eq('is_active', true);
      if (!mounted) return;
      setMemberIds((data ?? []).map((r) => r.member_id));
    }

    async function resyncPresence() {
      const { data } = await supabase
        .from('member_presence')
        .select('member_id, status, last_event_at')
        .eq('brand_id', brandId);
      if (!mounted) return;
      const map = new Map<string, PresenceRow>();
      for (const r of data ?? []) map.set(r.member_id, r);
      setPresence(map);
    }

    void resyncRoster();
    void resyncPresence();
    const localTick = setInterval(() => setNow(Date.now()), TICK_MS);
    const safetyResync = setInterval(() => {
      void resyncRoster();
      void resyncPresence();
    }, RESYNC_MS);

    const presenceChannel = supabase
      .channel(`presence:${brandId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_presence', filter: `brand_id=eq.${brandId}` },
        () => void resyncPresence(),
      )
      .subscribe();

    const rosterChannel = supabase
      .channel(`brand_members:${brandId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'brand_members', filter: `brand_id=eq.${brandId}` },
        () => void resyncRoster(),
      )
      .subscribe();

    return () => {
      mounted = false;
      clearInterval(localTick);
      clearInterval(safetyResync);
      void supabase.removeChannel(presenceChannel);
      void supabase.removeChannel(rosterChannel);
    };
  }, [brandId]);

  const counts = tally(memberIds, presence);
  const total = memberIds.length;

  return (
    <Link
      href={'/team' as Route}
      className="flex items-center gap-2 rounded-lg border border-line bg-canvas/40 px-2.5 py-2 text-[11.5px] text-txt-2 hover:bg-canvas"
      title={`${total} member${total === 1 ? '' : 's'} · ${counts.onCall} on call · ${counts.active} active · ${counts.idle} idle · ${counts.offline} offline`}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-txt-3">Live team</span>
      <span className="ml-auto flex items-center gap-2">
        <Dot color="bg-hp" count={counts.onCall} />
        <Dot color="bg-teal" count={counts.active} />
        <Dot color="bg-amber-500" count={counts.idle} />
        <Dot color="bg-txt-3/60" count={counts.offline} />
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
