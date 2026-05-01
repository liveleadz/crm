'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CalendarAppointment } from '@/lib/appointment-types';
import { AppointmentDialog, type AppointmentDialogTeamOpt } from './appointment-dialog';

const STATUS_TONE: Record<string, string> = {
  confirmed: 'border-ll/60 bg-ll/15 text-ll',
  scheduled: 'border-bs/60 bg-bs/15 text-bs',
  completed: 'border-teal/60 bg-teal/15 text-teal',
  pending: 'border-bi/60 bg-bi/15 text-bi',
  rescheduled: 'border-hb/60 bg-hb/15 text-hb',
  no_show: 'border-hp/60 bg-hp/15 text-hp',
  cancelled: 'border-line-2 bg-canvas text-txt-3 line-through',
};

// Start hour and total hours rendered. We render 7am..9pm (14 rows × 56px).
const START_HOUR = 7;
const END_HOUR = 21;
const SLOT_PX = 56;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayKeyOfIso(iso: string): string {
  return dayKey(new Date(iso));
}

function formatTimeRange(startIso: string, endIso: string | null): string {
  const s = new Date(startIso);
  const e = endIso ? new Date(endIso) : null;
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return e ? `${fmt(s)}–${fmt(e)}` : fmt(s);
}

// Position an appointment vertically based on its start time within the
// 7am..9pm grid. Out-of-window appointments still render at the edges.
function topPx(iso: string): number {
  const d = new Date(iso);
  const minutes = d.getHours() * 60 + d.getMinutes() - START_HOUR * 60;
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
}: {
  weekStartIso: string;
  appointments: CalendarAppointment[];
  team: AppointmentDialogTeamOpt[];
  agentFilterId: string | null;
  agentOptions: AppointmentDialogTeamOpt[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [createPreset, setCreatePreset] = useState<{ startIso: string } | null>(null);
  const [editing, setEditing] = useState<CalendarAppointment | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartIso);
    d.setDate(d.getDate() + i);
    return d;
  });

  const byDay = new Map<string, CalendarAppointment[]>();
  for (const a of appointments) {
    const key = dayKeyOfIso(a.startsAt);
    const list = byDay.get(key) ?? [];
    list.push(a);
    byDay.set(key, list);
  }

  function shiftWeek(deltaDays: number) {
    const d = new Date(weekStartIso);
    d.setDate(d.getDate() + deltaDays);
    const params = new URLSearchParams(searchParams.toString());
    params.set('week', dayKey(d));
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

  const rangeLabel = `${days[0]!.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[6]!.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const today = dayKey(new Date());

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
        {days.map((d) => {
          const isToday = dayKey(d) === today;
          return (
            <div
              key={dayKey(d)}
              className={`flex items-center gap-2 px-3 py-2 ${isToday ? 'text-teal' : 'text-txt-2'}`}
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                {d.toLocaleDateString([], { weekday: 'short' })}
              </div>
              <div className={`text-[14px] font-semibold ${isToday ? 'text-teal' : ''}`}>
                {d.getDate()}
              </div>
              <button
                type="button"
                onClick={() => {
                  const start = new Date(d);
                  start.setHours(9, 0, 0, 0);
                  setCreatePreset({ startIso: start.toISOString() });
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
        {days.map((d) => {
          const list = byDay.get(dayKey(d)) ?? [];
          const isToday = dayKey(d) === today;
          return (
            <div
              key={dayKey(d)}
              className={`relative border-r border-line ${isToday ? 'bg-teal/[0.03]' : ''}`}
              style={{ height: (END_HOUR - START_HOUR) * SLOT_PX }}
            >
              {Array.from({ length: END_HOUR - START_HOUR }, (_, i) => (
                <div
                  key={i}
                  className="border-b border-line/60"
                  style={{ height: SLOT_PX }}
                />
              ))}
              {list.map((a) => {
                const tone = STATUS_TONE[a.status] ?? 'border-line bg-canvas text-txt-2';
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setEditing(a)}
                    className={`absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-left text-[11px] shadow-sm transition hover:shadow-md ${tone}`}
                    style={{ top: topPx(a.startsAt), height: heightPx(a.startsAt, a.endsAt) }}
                  >
                    <div className="truncate font-semibold">{a.title}</div>
                    <div className="truncate text-[10.5px] opacity-80">
                      {formatTimeRange(a.startsAt, a.endsAt)} · {a.leadName ?? 'Lead'}
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
