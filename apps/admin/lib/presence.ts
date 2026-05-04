import 'server-only';

// Phase N: server-side reads against `member_presence`. Used by the
// sidebar's Live Team widget, the Live Floor agent grid, and the
// per-agent drill-down.
//
// "Stale" rows (last_event_at older than ~3 minutes) are reported as
// 'offline' regardless of their stored status — a client that crashed
// without a clean offline ping should not appear active forever.

import { createServerClient } from '@leadpilot/db/server';

export type PresenceStatus = 'on_call' | 'active' | 'idle' | 'offline';

export type PresenceRow = {
  memberId: string;
  status: PresenceStatus;
  lastEventAt: string;
  secondsToday: number;
};

const STALE_MS = 3 * 60 * 1000;

function effectiveStatus(raw: string | null, lastEventAt: string | null): PresenceStatus {
  if (!lastEventAt) return 'offline';
  if (Date.now() - new Date(lastEventAt).getTime() > STALE_MS) return 'offline';
  if (raw === 'on_call' || raw === 'active' || raw === 'idle' || raw === 'offline') return raw;
  return 'offline';
}

export async function loadBrandPresence(brandId: string): Promise<PresenceRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('member_presence')
    .select('member_id, status, last_event_at, seconds_today')
    .eq('brand_id', brandId);
  return (data ?? []).map((r) => ({
    memberId: r.member_id,
    status: effectiveStatus(r.status, r.last_event_at),
    lastEventAt: r.last_event_at,
    secondsToday: r.seconds_today ?? 0,
  }));
}

// Counts shaped for the sidebar's compact "Live team" widget.
export type PresenceCounts = {
  onCall: number;
  active: number;
  idle: number;
  offline: number;
};

export async function loadPresenceCounts(brandId: string): Promise<PresenceCounts> {
  const rows = await loadBrandPresence(brandId);
  const counts: PresenceCounts = { onCall: 0, active: 0, idle: 0, offline: 0 };
  for (const r of rows) {
    if (r.status === 'on_call') counts.onCall += 1;
    else if (r.status === 'active') counts.active += 1;
    else if (r.status === 'idle') counts.idle += 1;
    else counts.offline += 1;
  }
  return counts;
}
