'use client';

// Phase O: agent grid for the Live Floor. Filter chips bucket the team
// by presence (All / On call / Active / Idle / Offline). Real-time
// updates come from the existing presence Realtime channel — when a
// row updates the snapshot endpoint refetches.

import { useEffect, useMemo, useState } from 'react';
import { createBrowserClient } from '@leadpilot/db/client';
import type { AgentSnapshot } from '@/lib/live-floor';
import { LivePulseDot } from './live-pulse-dot';

type Filter = 'all' | 'on_call' | 'active' | 'idle' | 'offline';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'on_call', label: 'On call' },
  { value: 'active', label: 'Active' },
  { value: 'idle', label: 'Idle' },
  { value: 'offline', label: 'Offline' },
];

const PRESENCE_LABEL: Record<AgentSnapshot['presence'], string> = {
  on_call: 'On call',
  active: 'Active',
  idle: 'Idle',
  offline: 'Offline',
};

const PRESENCE_DOT: Record<AgentSnapshot['presence'], string> = {
  on_call: 'bg-hp',
  active: 'bg-teal',
  idle: 'bg-amber-500',
  offline: 'bg-txt-3/40',
};

function fmtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function AgentGrid({
  brandId,
  initial,
}: {
  brandId: string;
  initial: AgentSnapshot[];
}) {
  const [snapshots, setSnapshots] = useState<AgentSnapshot[]>(initial);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const supabase = createBrowserClient();
    async function refresh() {
      const res = await fetch('/api/live/agents', { cache: 'no-store' });
      if (!res.ok) return;
      const data: AgentSnapshot[] = await res.json();
      setSnapshots(data);
    }
    const channel = supabase
      .channel(`live-agents:${brandId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_presence', filter: `brand_id=eq.${brandId}` },
        () => void refresh(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls', filter: `brand_id=eq.${brandId}` },
        () => void refresh(),
      )
      .subscribe();
    // Periodic refetch as a backstop so seconds_today stays fresh.
    const tick = setInterval(refresh, 30 * 1000);
    return () => {
      clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [brandId]);

  const filtered = useMemo(
    () =>
      filter === 'all' ? snapshots : snapshots.filter((s) => s.presence === filter),
    [filter, snapshots],
  );

  const counts = useMemo(() => {
    const c = { on_call: 0, active: 0, idle: 0, offline: 0 } as Record<
      AgentSnapshot['presence'],
      number
    >;
    for (const s of snapshots) c[s.presence] += 1;
    return c;
  }, [snapshots]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => {
          const on = filter === f.value;
          const n = f.value === 'all' ? snapshots.length : counts[f.value];
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-full border px-3 py-1 text-[11.5px] font-medium ${
                on
                  ? 'border-teal/60 bg-teal/10 text-teal'
                  : 'border-line bg-surface text-txt-2 hover:bg-canvas'
              }`}
            >
              {f.label} <span className="ml-1 tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface p-6 text-center text-[12.5px] text-txt-3">
          No agents in this filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <div key={s.memberId} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-2">
                {s.presence === 'on_call' ? (
                  <LivePulseDot active />
                ) : (
                  <span className={`h-2 w-2 rounded-full ${PRESENCE_DOT[s.presence]}`} />
                )}
                <span className="text-[13.5px] font-medium">{s.name}</span>
                <span className="ml-auto text-[11px] uppercase tracking-wide text-txt-3">
                  {PRESENCE_LABEL[s.presence]}
                </span>
              </div>
              {s.currentCall && (
                <div className="rounded-lg border border-hp/30 bg-hp/5 px-2 py-1.5 text-[11.5px] text-txt-2">
                  Calling <span className="font-medium">{s.currentCall.leadName ?? s.currentCall.toNumber}</span>
                  {s.currentCall.campaignName && (
                    <span className="text-txt-3"> · {s.currentCall.campaignName}</span>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-[11.5px] text-txt-2">
                <Stat label="Calls" value={s.callsToday} />
                <Stat label="Connects" value={s.connectsToday} />
                <Stat label="Appts" value={s.appointmentsToday} />
              </div>
              <div className="text-[10.5px] text-txt-3">
                {fmtTime(s.secondsToday)} on screen today
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-canvas/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-txt-3">{label}</div>
      <div className="text-[13px] font-medium tabular-nums text-txt">{value}</div>
    </div>
  );
}
