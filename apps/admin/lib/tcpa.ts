// TCPA dial-window helpers. Pure (no I/O) so both server-only loaders and
// server actions can share the same logic. Brand-local timezone fallback
// keeps things working for international leads or rows imported without a
// state — the soft block is opt-in per campaign so a missing timezone
// can't accidentally silence the whole queue.

import { getLocalParts } from './datetime';

// US state / territory → IANA timezone. Multi-zone states default to the
// most populous zone:
//   - TX/KS/NE/ND/SD/KY/TN/MI/IN: most population in Central → America/Chicago
//     (KY/TN/MI/IN have a Central minority but the dominant zone is Eastern;
//     here we default IN/KY/TN/MI to Eastern, KS/NE/ND/SD to Central, TX
//     to Central — Houston/Dallas/Austin/SA all sit in Central.)
//   - FL: Eastern (panhandle is Central, but Miami/Orlando/Tampa dominate).
//   - OR/ID: Pacific (small Mountain slivers ignored).
//   - AK has multiple zones; America/Anchorage covers >95% population.
// Codes match leads.state convention (2-letter, uppercased).
const STATE_TZ: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DE: 'America/New_York',
  DC: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  ID: 'America/Los_Angeles',
  IL: 'America/Chicago',
  IN: 'America/New_York',
  IA: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  ME: 'America/New_York',
  MD: 'America/New_York',
  MA: 'America/New_York',
  MI: 'America/New_York',
  MN: 'America/Chicago',
  MS: 'America/Chicago',
  MO: 'America/Chicago',
  MT: 'America/Denver',
  NE: 'America/Chicago',
  NV: 'America/Los_Angeles',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NY: 'America/New_York',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/New_York',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VT: 'America/New_York',
  VA: 'America/New_York',
  WA: 'America/Los_Angeles',
  WV: 'America/New_York',
  WI: 'America/Chicago',
  WY: 'America/Denver',
  // Territories
  PR: 'America/Puerto_Rico',
  VI: 'America/Puerto_Rico',
  GU: 'Pacific/Guam',
};

export type TcpaPolicy = {
  enabled: boolean;
  startMin: number; // 0..1440, inclusive
  endMin: number; // 0..1440, exclusive
  skipWeekends: boolean;
};

export function pickLeadTimezone(
  state: string | null | undefined,
  brandTimezone: string,
): string {
  if (!state) return brandTimezone;
  const key = state.trim().toUpperCase();
  return STATE_TZ[key] ?? brandTimezone;
}

// Inclusive of `startMin`, exclusive of `endMin`. When end < start, the
// window is treated as empty (caller error) — the editor clamps so this
// shouldn't happen in practice.
function inWindow(minOfDay: number, startMin: number, endMin: number): boolean {
  if (endMin <= startMin) return false;
  return minOfDay >= startMin && minOfDay < endMin;
}

export type WindowCheck =
  | { ok: true; leadTz: string; localHHMM: string }
  | {
      ok: false;
      leadTz: string;
      reason: string;
      // ISO instant when the next allowed window opens, in UTC.
      nextOpenIso: string;
    };

// Pretty "HH:MM" from minute-of-day.
export function formatMin(min: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(min)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Compute the next instant the dial window opens for a given local-time
// definition. Walks forward at most 8 days (covers any weekend skip).
function nextOpen(
  now: Date,
  tz: string,
  policy: TcpaPolicy,
): { iso: string; localLabel: string } {
  for (let offsetDays = 0; offsetDays < 8; offsetDays++) {
    const probe = new Date(now.getTime() + offsetDays * 86_400_000);
    const parts = getLocalParts(probe, tz);
    const isWeekend = parts.weekday === 0 || parts.weekday === 6;
    if (policy.skipWeekends && isWeekend) continue;
    const minOfDay = parts.hour * 60 + parts.minute;
    if (offsetDays === 0 && minOfDay < policy.endMin) {
      // Same day, window still upcoming or in progress.
      const target = Math.max(minOfDay, policy.startMin);
      // Already inside window? Caller wouldn't be here, but guard anyway.
      if (target >= policy.startMin && target < policy.endMin) {
        // Window is open right now — return now.
        return {
          iso: probe.toISOString(),
          localLabel: `${formatMin(minOfDay)} ${tz}`,
        };
      }
      if (minOfDay < policy.startMin) {
        // Build an instant matching today's local startMin.
        return {
          iso: localTimeToIso(parts.year, parts.month, parts.day, policy.startMin, tz),
          localLabel: `${formatMin(policy.startMin)} ${tz}`,
        };
      }
    }
    if (offsetDays > 0) {
      // For future days, skip-weekends already filtered above.
      return {
        iso: localTimeToIso(parts.year, parts.month, parts.day, policy.startMin, tz),
        localLabel: `${formatMin(policy.startMin)} ${tz}`,
      };
    }
  }
  // Fallback: 24h from now.
  return {
    iso: new Date(now.getTime() + 86_400_000).toISOString(),
    localLabel: `${formatMin(policy.startMin)} ${tz}`,
  };
}

// Local wall-clock (Y/M/D + minute-of-day) → UTC ISO. Inlined instead of
// importing `zonedToUtcIso` so we don't pay the probe cost twice when
// callers only need a coarse "next open" hint.
function localTimeToIso(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  tz: string,
): string {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const probeParts = getLocalParts(new Date(utcGuess), tz);
  const asLocalUtc = Date.UTC(
    probeParts.year,
    probeParts.month - 1,
    probeParts.day,
    probeParts.hour,
    probeParts.minute,
  );
  const offset = asLocalUtc - utcGuess;
  return new Date(utcGuess - offset).toISOString();
}

// Decide if a single lead can be dialed right now under `policy`. Returns
// a structured result so the dialer can show a clear toast.
export function dialWindowCheck({
  leadState,
  brandTimezone,
  policy,
  now = new Date(),
}: {
  leadState: string | null | undefined;
  brandTimezone: string;
  policy: TcpaPolicy;
  now?: Date;
}): WindowCheck {
  const leadTz = pickLeadTimezone(leadState, brandTimezone);
  if (!policy.enabled) {
    const parts = getLocalParts(now, leadTz);
    return {
      ok: true,
      leadTz,
      localHHMM: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
    };
  }
  const parts = getLocalParts(now, leadTz);
  const minOfDay = parts.hour * 60 + parts.minute;
  const isWeekend = parts.weekday === 0 || parts.weekday === 6;
  if (policy.skipWeekends && isWeekend) {
    const open = nextOpen(now, leadTz, policy);
    return {
      ok: false,
      leadTz,
      reason: 'Weekend dialing disabled',
      nextOpenIso: open.iso,
    };
  }
  if (!inWindow(minOfDay, policy.startMin, policy.endMin)) {
    const open = nextOpen(now, leadTz, policy);
    const reason =
      minOfDay < policy.startMin
        ? `Before window (${formatMin(policy.startMin)} ${leadTz})`
        : `After window (closes ${formatMin(policy.endMin)} ${leadTz})`;
    return { ok: false, leadTz, reason, nextOpenIso: open.iso };
  }
  return {
    ok: true,
    leadTz,
    localHHMM: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  };
}
