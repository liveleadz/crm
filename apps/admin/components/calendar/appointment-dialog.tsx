'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  createAppointment,
  deleteAppointment,
  updateAppointment,
} from '@/app/actions/appointments';
import { searchLeads } from '@/app/actions/leads';
import { APPT_STATUSES, type AppointmentStatus, type CalendarAppointment } from '@/lib/appointment-types';

export type AppointmentDialogTeamOpt = { id: string; name: string };
export type AppointmentDialogCalendarOpt = {
  id: string;
  name: string;
  color: string | null;
  ownerMemberId: string | null;
};

type LeadOpt = { id: string; name: string; phone: string | null; email: string | null };

// Convert ISO timestamp → "YYYY-MM-DDTHH:mm" suitable for <input type="datetime-local">.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(local: string): string | null {
  if (!local) return null;
  // datetime-local has no zone; treat as browser-local and convert to UTC ISO.
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AppointmentDialog({
  mode,
  appointment,
  presetStartIso,
  presetLead,
  team,
  calendars = [],
  onClose,
}: {
  mode: 'create' | 'edit';
  appointment?: CalendarAppointment | null;
  presetStartIso?: string | null;
  presetLead?: { id: string; name: string } | null;
  team: AppointmentDialogTeamOpt[];
  calendars?: AppointmentDialogCalendarOpt[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [title, setTitle] = useState(appointment?.title ?? 'Discovery call');
  const [startsLocal, setStartsLocal] = useState(
    isoToLocalInput(appointment?.startsAt ?? presetStartIso ?? new Date().toISOString()),
  );
  const [endsLocal, setEndsLocal] = useState(isoToLocalInput(appointment?.endsAt ?? null));
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const initialCalendarId =
    appointment?.calendarId ?? calendars[0]?.id ?? '';
  const [calendarId, setCalendarId] = useState<string>(initialCalendarId);
  const initialCalendar = calendars.find((c) => c.id === initialCalendarId) ?? null;
  const [memberId, setMemberId] = useState<string>(
    appointment?.memberId ?? initialCalendar?.ownerMemberId ?? team[0]?.id ?? '',
  );
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? 'scheduled');

  // When the agent picks a different calendar, default the assigned setter to
  // that calendar's owner so the closer sees their own appointments.
  function pickCalendar(id: string) {
    setCalendarId(id);
    if (mode === 'create') {
      const cal = calendars.find((c) => c.id === id);
      if (cal?.ownerMemberId) setMemberId(cal.ownerMemberId);
    }
  }

  // Lead picker state — only relevant in create mode.
  const [selectedLead, setSelectedLead] = useState<LeadOpt | null>(
    presetLead
      ? { id: presetLead.id, name: presetLead.name, phone: null, email: null }
      : appointment?.leadId
        ? {
            id: appointment.leadId,
            name: appointment.leadName ?? 'Lead',
            phone: appointment.leadPhone,
            email: null,
          }
        : null,
  );
  const [leadQuery, setLeadQuery] = useState('');
  const [leadResults, setLeadResults] = useState<LeadOpt[]>([]);
  const [leadOpen, setLeadOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Debounced lead search (skip if a lead is already selected and the
  // query matches its label).
  useEffect(() => {
    if (mode !== 'create') return;
    if (selectedLead) return;
    const q = leadQuery.trim();
    if (!q) {
      setLeadResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const results = await searchLeads({ query: q });
      setLeadResults(results);
    }, 200);
    return () => clearTimeout(handle);
  }, [leadQuery, mode, selectedLead]);

  async function submit() {
    setError(null);
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    const startsIso = localInputToIso(startsLocal);
    if (!startsIso) {
      setError('Start time is required.');
      return;
    }
    const endsIso = endsLocal ? localInputToIso(endsLocal) : null;

    setSaving(true);
    if (mode === 'create') {
      if (!selectedLead) {
        setError('Pick a lead to schedule for.');
        setSaving(false);
        return;
      }
      if (calendars.length > 0 && !calendarId) {
        setError('Pick a calendar.');
        setSaving(false);
        return;
      }
      const res = await createAppointment({
        leadId: selectedLead.id,
        title: title.trim(),
        startsAt: startsIso,
        endsAt: endsIso,
        location: location || null,
        notes: notes || null,
        memberId: memberId || null,
        calendarId: calendarId || null,
        status,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
    } else if (appointment) {
      const res = await updateAppointment({
        id: appointment.id,
        title: title.trim(),
        startsAt: startsIso,
        endsAt: endsIso,
        location: location || null,
        notes: notes || null,
        memberId: memberId || null,
        calendarId: calendarId || null,
        status,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
    }
    onClose();
    startTransition(() => router.refresh());
  }

  async function remove() {
    if (!appointment) return;
    if (!confirm('Delete this appointment?')) return;
    setSaving(true);
    const res = await deleteAppointment({ id: appointment.id });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onClose();
    startTransition(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40"
      />
      <div
        role="dialog"
        aria-label={mode === 'create' ? 'New appointment' : 'Edit appointment'}
        className="fixed left-1/2 top-1/2 z-50 w-[460px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[14.5px] font-semibold">
            {mode === 'create' ? 'New appointment' : 'Edit appointment'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-txt-3 hover:bg-canvas"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          {mode === 'create' && (
            <Field label="Lead">
              {selectedLead ? (
                <div className="flex items-center justify-between rounded-lg border border-line bg-canvas px-2.5 py-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[12.5px] font-medium">{selectedLead.name}</div>
                    {(selectedLead.phone || selectedLead.email) && (
                      <div className="truncate text-[11px] text-txt-3">
                        {selectedLead.phone ?? selectedLead.email}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLead(null);
                      setLeadQuery('');
                      setLeadOpen(true);
                    }}
                    className="text-[11px] text-teal hover:underline"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search by name, phone, or email…"
                    value={leadQuery}
                    onChange={(e) => {
                      setLeadQuery(e.target.value);
                      setLeadOpen(true);
                    }}
                    onFocus={() => setLeadOpen(true)}
                    className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
                  />
                  {leadOpen && leadResults.length > 0 && (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-surface shadow-lg">
                      {leadResults.map((l) => (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedLead(l);
                              setLeadOpen(false);
                            }}
                            className="block w-full px-2.5 py-1.5 text-left hover:bg-canvas"
                          >
                            <div className="text-[12.5px] font-medium">{l.name}</div>
                            <div className="text-[11px] text-txt-3">
                              {l.phone ?? l.email ?? '—'}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Field>
          )}

          <Field label="Title">
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input
                type="datetime-local"
                value={startsLocal}
                onChange={(e) => setStartsLocal(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
              />
            </Field>
            <Field label="Ends (optional)">
              <input
                type="datetime-local"
                value={endsLocal}
                onChange={(e) => setEndsLocal(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
              />
            </Field>
          </div>

          {calendars.length > 0 && (
            <Field label="Calendar">
              <select
                value={calendarId}
                onChange={(e) => pickCalendar(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
              >
                <option value="">No calendar</option>
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="Assigned to">
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
            >
              <option value="">Unassigned</option>
              {team.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] capitalize outline-none focus:border-teal/60"
              >
                {APPT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <input
                type="text"
                placeholder="Zoom, office, phone…"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
            />
          </Field>

          {error && <div className="text-[11.5px] text-hp">{error}</div>}

          <div className="flex items-center gap-2 pt-1">
            {mode === 'edit' && (
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="rounded-lg border border-hp/30 px-3 py-1.5 text-[12px] font-medium text-hp hover:bg-hp/10 disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : mode === 'create' ? 'Schedule' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
        {label}
      </span>
      {children}
    </label>
  );
}
