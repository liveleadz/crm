// Brand-timezone-aware datetime helpers. Pure: no I/O, safe to import
// from both server and client modules. All functions take an IANA
// timezone string (e.g. 'America/New_York').
//
// The reports trend/heatmap and calendar week-view both bucket times by
// brand-local day/hour. Doing this with the JS Date API alone would key
// off the server's timezone (or the browser's) rather than the brand's.
// `getLocalParts` extracts the wall-clock parts in any tz; the rest of
// the helpers here build day keys and week boundaries on top of it.

export type LocalParts = {
  year: number;
  month: number;     // 1..12
  day: number;       // 1..31
  hour: number;      // 0..23
  minute: number;    // 0..59
  second: number;    // 0..59
  weekday: number;   // 0=Sun..6=Sat
};

const PARTS_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = PARTS_FMT_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    PARTS_FMT_CACHE.set(tz, f);
  }
  return f;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function getLocalParts(input: string | Date, tz: string): LocalParts {
  const d = typeof input === 'string' ? new Date(input) : input;
  const map: Record<string, string> = {};
  for (const p of partsFormatter(tz).formatToParts(d)) map[p.type] = p.value;
  // `hour: '2-digit'` with hourCycle:'h23' returns '00'..'23' on modern
  // engines, but Node's older ICU sometimes returns '24' at midnight.
  const rawHour = Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: WEEKDAY_INDEX[map.weekday ?? ''] ?? 0,
  };
}

// "YYYY-MM-DD" key for the brand-local day containing this instant.
export function localDayKey(input: string | Date, tz: string): string {
  const p = getLocalParts(input, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// "HH:MM" 24-hour clock for the brand-local time of this instant.
export function formatLocalTime(input: string | Date, tz: string): string {
  const p = getLocalParts(input, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// Convert a wall-clock time in `tz` to its corresponding UTC ISO instant.
// Resolves DST gaps/overlaps by probing how the guessed UTC instant is
// rendered in `tz` and folding the offset back into the answer.
export function zonedToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  tz: string,
): string {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const probeParts = getLocalParts(new Date(utcGuess), tz);
  const asLocalUtc = Date.UTC(
    probeParts.year,
    probeParts.month - 1,
    probeParts.day,
    probeParts.hour,
    probeParts.minute,
    probeParts.second,
  );
  const offset = asLocalUtc - utcGuess;
  return new Date(utcGuess - offset).toISOString();
}

// UTC ISO at brand-local 00:00 on the Monday of the week containing
// `input` (defaults to "now"). Used to align the calendar week grid.
export function localStartOfWeekIso(
  input: string | Date | undefined,
  tz: string,
): string {
  const base =
    input === undefined
      ? new Date()
      : typeof input === 'string'
        ? new Date(input)
        : input;
  const p = getLocalParts(base, tz);
  // Monday=0..Sunday=6 shift, so Monday is the start of the week.
  const offsetDays = (p.weekday + 6) % 7;
  const dayUtc =
    Date.UTC(p.year, p.month - 1, p.day) - offsetDays * 86_400_000;
  const monday = new Date(dayUtc);
  return zonedToUtcIso(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    0, 0, 0,
    tz,
  );
}

// Add N brand-local calendar days to a UTC ISO instant, preserving the
// wall-clock time of day. DST-safe (re-resolves the offset on the
// destination day).
export function addLocalDaysIso(iso: string, days: number, tz: string): string {
  const p = getLocalParts(iso, tz);
  const dayUtc = Date.UTC(p.year, p.month - 1, p.day) + days * 86_400_000;
  const d = new Date(dayUtc);
  return zonedToUtcIso(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    p.hour, p.minute, p.second,
    tz,
  );
}

// Rolling time-window resolver shared by the per-rep scorecard and the
// team leaderboard. Anchored to brand-local "today" so windows like
// "last 7 days" cover today + 6 prior calendar days, not 7×24h back
// from now (which would chop today in half).
export type RollingRange = '1d' | '7d' | '30d' | '90d' | 'custom';

export function rollingRangeBounds(
  range: RollingRange,
  tz: string,
  custom?: { fromIso?: string | null; toIso?: string | null },
  now: Date = new Date(),
): { fromIso: string; toIso: string } {
  if (range === 'custom' && custom?.fromIso && custom?.toIso) {
    return { fromIso: custom.fromIso, toIso: custom.toIso };
  }
  const p = getLocalParts(now, tz);
  const todayStart = zonedToUtcIso(p.year, p.month, p.day, 0, 0, 0, tz);
  const days = range === '1d' ? 1 : range === '7d' ? 7 : range === '90d' ? 90 : 30;
  const fromIso = days === 1 ? todayStart : addLocalDaysIso(todayStart, -(days - 1), tz);
  return { fromIso, toIso: now.toISOString() };
}

// Step a "YYYY-MM-DD" string forward by N days, interpreted as a
// calendar date with no timezone. Used for trend axis enumeration.
export function addDaysToDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const next = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
