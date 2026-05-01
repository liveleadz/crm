'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CalendarAppointment } from '@/lib/appointment-types';
import {
  addLocalDaysIso,
  formatLocalTime,
  getLocalParts,
  localDayKey,
  zonedToUtcIso,
} from '@/lib/datetime';
import {
  AppointmentDialog,
  type AppointmentDialogCalendarOpt,
  type AppointmentDialogTeamOpt,
} from './appointment-dialog';

const STATUS_TONE: Record<string, string> = {
  confirmed: 'border-ll/60 bg-ll/15 text-ll',
  scheduled: 'border-bs/60 bg-bs/15 text-bs',
  completed: 'border-teal/60 bg-teal/15 text-teal',
  pending: 'border-bi/60 bg-bi/15 text-bi',
  rescheduled: 'border-hb/60 bg-hb/15 text-hb',
  no_show: 'border-hp/60 bg-hp/15 text-hp',
  cancelled: 'border-line-2 bg-canvas text-txt-3 line-through',
};

// Per-calendar accent map. The calendar.color value is a design token from
// the calendars-manager picker (teal/hp/vl/amber). Falls back to the status
// tone so legacy untagged appointments keep their colors.
const CALENDAR_TONE: Record<string, string> = {
  teal: 'border-teal/60 bg-teal/15 text-teal',
  hp: 'border-hp/60 bg-hp/15 text-hp',
  vl: 'border-vl/60 bg-vl/15 text-vl',
  amber: 'border-amber-500/60 bg-amber-500/15 text-amber-700',
};

// Start hour and total hours rendered. We render 7am..9pm (14 rows × 56px).
const START_HOUR = 7;
const END_HOUR = 21;
const SLOT_PX = 56;

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatTimeRange(startIso: string, endIso: string | null, tz: string): string {
  const s = formatLocalTime(startIso, tz);
  const e = endIso ? formatLocalTime(endIso, tz) : null;
  return e ? `${s}–${e}` : s;
}

// Position an appointment vertically based on its brand-local start
// time within the 7am..9pm grid. Out-of-window appointments still
// render at the edges.
function topPx(iso: string, tz: string): number {
  const p = getLocalParts(iso, tz);
  const minutes = p.hour * 60 + p.minute - START_HOUR * 60;
  return Math.max(0, (minutes / 60) * SLOT_PX);
}

function heightPx(startIso: string, endIso: string | null): number {
  if (!endIso) return SLOT_PX - 4;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const minutes = Math.max(15, (end - start) / 60_000);
  return Math.max(24, (minutes / 60) * SLOT_PX - 4);
}

export function WeekView({
  weekStartIso,
  appointments,
  team,
  agentFilterId,
  agentOptions,
  calendars,
  calendarFilterId,
  timezone,
}: {
  weekStartIso: string;
  appointments: CalendarAppointment[];
  team: AppointmentDialogTeamOpt[];
  agentFilterId: string | null;
  agentOptions: AppointmentDialogTeamOpt[];
  calendars: AppointmentDialogCalendarOpt[];
  calendarFilterId: string | null;
  timezone: string;
}) {
  const calendarById = new Map(calendars.map((c) => [c.id, c]));
  const router = useRouter();
  const searchParams = useSearchParams();

  const [createPreset, setCreatePreset] = useState<{ startIso: string } | null>(null);
  const [editing, setEditing] = useState<CalendarAppointment | null>(null);

  // Each day in the week-grid is the brand-local 00:00 of a calendar
  // day, expressed as a UTC ISO instant. The visual columns are keyed
  // by the brand-local YYYY-MM-DD of those instants.
  const days = Array.from({ length: 7 }, (_, i) =>
    addLocalDaysIso(weekStartIso, i, timezone),
  );
  const dayKeys = days.map((iso) => localDayKey(iso, timezone));
  const dayParts = days.map((iso) => getLocalParts(iso, timezone));
  const todayKey = localDayKey(new Date(), timezone);

  const byDay = new Map<string, CalendarAppointment[]>();
  for (const a of appointments) {
    const key = localDayKey(a.startsAt, timezone);
    const list = byDay.get(key) ?? [];
    list.push(a);
    byDay.set(key, list);
  }

  function shiftWeek(deltaDays: number) {
    const nextStart = addLocalDaysIso(weekStartIso, deltaDays, timezone);
    const params = new URLSearchParams(searchParams.toString());
    params.set('week', localDayKey(nextStart, timezone));
    router.push(`/calendar?${params.toString()}`);
  }

  function gotoToday() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('week');
    const qs = params.toString();
    router.push(qs ? `/calendar?${qs}` : '/calendar');
  }

  function setAgent(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('member', value);
    else params.delete('member');
    const qs = params.toString();
    router.push(qs ? `/calendar?${qs}` : '/calendar');
  }

  function setCalendar(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('calendar', value);
    else params.delete('calendar');
    const qs = params.toString();
    router.push(qs ? `/calendar?${qs}` : '/calendar');
  }

  const monthShort = (m: number) =>
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] ?? '';
  const first = dayParts[0]!;
  const last = dayParts[6]!;
  const rangeLabel = `${monthShort(first.month)} ${first.day} – ${monthShort(last.month)} ${last.day}`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftWeek(-7)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-txt-2 hover:bg-canvas"
            aria-label="Previous week"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => shiftWeek(7)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-line text-txt-2 hover:bg-canvas"
            aria-label="Next week"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={gotoToday}
            className="ml-1 rounded-lg border border-line px-2.5 py-1 text-[12px] font-medium text-txt-2 hover:bg-canvas"
          >
            Today
          </button>
        </div>
        <div className="text-[13px] font-semibold">{rangeLabel}</div>
        <div className="ml-auto flex items-center gap-2">
          {calendars.length > 0 && (
            <select
              value={calendarFilterId ?? ''}
              onChange={(e) => setCalendar(e.target.value)}
              className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60"
            >
              <option value="">All calendars</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={agentFilterId ?? ''}
            onChange={(e) => setAgent(e.target.value)}
            className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60"
          >
            <option value="">All setters</option>
            {agentOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              d.setMinutes(0, 0, 0);
              setCreatePreset({ startIso: d.toISOString() });
            }}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90"
          >
            + New appointment
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line bg-canvas/40">
        <div />
        {days.map((iso, i) => {
          const key = dayKeys[i]!;
          const parts = dayParts[i]!;
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`flex items-center gap-2 px-3 py-2 ${isToday ? 'text-teal' : 'text-txt-2'}`}
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                {WEEKDAY_LABELS[i]}
              </div>
              <div className={`text-[14px] font-semibold ${isToday ? 'text-teal' : ''}`}>
                {parts.day}
              </div>
              <button
                type="button"
                onClick={() => {
                  // Open the dialog at 9am brand-local for that day.
                  const startIso = zonedToUtcIso(
                    parts.year, parts.month, parts.day, 9, 0, 0, timezone,
                  );
                  setCreatePreset({ startIso });
                }}
                className="ml-auto grid h-6 w-6 place-items-center rounded-md text-txt-3 hover:bg-canvas hover:text-txt-1"
                aria-label="Add appointment to this day"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
        <div className="border-r border-line">
          {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => {
            const hour = START_HOUR + i;
            return (
              <div
                key={hour}
                className="flex items-start justify-end pr-2 text-[10.5px] text-txt-3"
                style={{ height: SLOT_PX }}
              >
                <span className="-translate-y-1.5 bg-canvas/0">{String(hour).padStart(2, '0')}:00</span>
              </div>
            );
          })}
        </div>
        {days.map((_iso, i) => {
          const key = dayKeys[i]!;
          const list = byDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={`relative border-r border-line ${isToday ? 'bg-teal/[0.03]' : ''}`}
              style={{ height: (END_HOUR - START_HOUR) * SLOT_PX }}
            >
              {Array.from({ length: END_HOUR - START_HOUR }, (_, j) => (
                <div
                  key={j}
                  className="border-b border-line/60"
                  style={{ height: SLOT_PX }}
                />
              ))}
              {list.map((a) => {
                const cal = a.calendarId ? calendarById.get(a.calendarId) : null;
                const calTone = cal?.color ? CALENDAR_TONE[cal.color] : null;
                const tone = calTone ?? STATUS_TONE[a.status] ?? 'border-line bg-canvas text-txt-2';
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setEditing(a)}
                    className={`absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] shadow-sm transition hover:shadow-md ${tone}`}
                    style={{ top: topPx(a.startsAt, timezone), height: heightPx(a.startsAt, a.endsAt) }}
                  >
                    <div className="truncate font-semibold">{a.title}</div>
                    <div className="truncate text-[10.5px] opacity-80">
                      {formatTimeRange(a.startsAt, a.endsAt, timezone)} · {a.leadName ?? 'Lead'}
                    </div>
                    {a.location && (
                      <div className="truncate text-[10px] opacity-70">{a.location}</div>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {(createPreset || editing) && (
        <AppointmentDialog
          mode={editing ? 'edit' : 'create'}
          appointment={editing}
          presetStartIso={createPreset?.startIso ?? null}
          team={team}
          calendars={calendars}
          onClose={() => {
            setCreatePreset(null);
            setEditing(null);
          }}
        />
      )}

      {appointments.length === 0 && (
        <div className="border-t border-line bg-canvas/40 px-6 py-3 text-[11.5px] text-txt-3">
          No appointments this week.{' '}
          <Link href="/leads" className="text-teal hover:underline">
            Open a lead
          </Link>{' '}
          to schedule one.
        </div>
      )}
    </>
  );
}
