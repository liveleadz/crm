'use server';

// Phase N: pingPresence — upserts the caller's row in member_presence
// once per minute (or whenever status changes). Accumulates today's
// active seconds based on the diff since last_event_at, but only when
// the previous status was active or on_call. Idle and offline don't
// accumulate.
//
// We compare brand-local-day instead of UTC so an agent working a 9-5
// PT shift sees their seconds_today reset at midnight Pacific, not at
// midnight UTC mid-afternoon.

import { getActiveBrand } from '@/lib/active-brand';
import { createServerClient } from '@leadpilot/db/server';

type PresenceStatus = 'on_call' | 'active' | 'idle' | 'offline';

const VALID: PresenceStatus[] = ['on_call', 'active', 'idle', 'offline'];

// Cap a single accumulation slice so a misbehaving client (e.g. tab
// suspended for hours then re-pinging) can't add an absurd run of
// seconds in one hop.
const MAX_SLICE_SEC = 90;

function localDayKey(iso: string, tz: string): string {
  // Same shape as `lib/datetime.ts.localDayKey`. Inlined here because
  // server actions can't import the report-side datetime helpers without
  // pulling 'server-only' modules transitively into other contexts; the
  // logic is one Intl.DateTimeFormat call.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(iso));
}

export async function pingPresence(input: {
  status: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!VALID.includes(input.status as PresenceStatus)) {
    return { ok: false, error: 'Invalid status.' };
  }
  const status = input.status as PresenceStatus;

  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const nowIso = new Date().toISOString();
  const tz = active.timezone || 'UTC';

  const { data: existing } = await supabase
    .from('member_presence')
    .select('status, last_event_at, last_session_started_at, seconds_today')
    .eq('brand_id', active.id)
    .eq('member_id', user.id)
    .maybeSingle();

  // Decide whether to roll seconds_today over. We roll when the previous
  // session started on a different brand-local day from now.
  const todayKey = localDayKey(nowIso, tz);
  const prevSessionKey = existing?.last_session_started_at
    ? localDayKey(existing.last_session_started_at, tz)
    : null;
  const newDay = prevSessionKey === null || prevSessionKey !== todayKey;

  // Accumulate only if the previous status was a working state.
  let secondsToday = newDay ? 0 : existing?.seconds_today ?? 0;
  if (
    !newDay &&
    existing?.last_event_at &&
    (existing.status === 'active' || existing.status === 'on_call')
  ) {
    const diffSec = Math.max(
      0,
      Math.round((Date.now() - new Date(existing.last_event_at).getTime()) / 1000),
    );
    secondsToday += Math.min(diffSec, MAX_SLICE_SEC);
  }

  const lastSessionStartedAt = newDay
    ? nowIso
    : existing?.last_session_started_at ?? nowIso;

  const { error } = await supabase
    .from('member_presence')
    .upsert(
      {
        brand_id: active.id,
        member_id: user.id,
        status,
        last_event_at: nowIso,
        last_session_started_at: lastSessionStartedAt,
        seconds_today: secondsToday,
      },
      { onConflict: 'brand_id,member_id' },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
