'use client';

import { useEffect, useState, useTransition } from 'react';
import { createTask, updateTask } from '@/app/actions/tasks';
import type {
  RecurrenceRule,
  ReminderChannel,
  TaskKind,
  TaskPriority,
  TaskRow,
} from '@/lib/tasks';
import type { TeamMemberOpt } from './tasks-view';

const KINDS: { value: TaskKind; label: string }[] = [
  { value: 'call', label: '📞 Call' },
  { value: 'text', label: '💬 Text' },
  { value: 'email', label: '✉️ Email' },
  { value: 'meeting', label: '📅 Meeting' },
  { value: 'note', label: '📝 Note' },
  { value: 'other', label: '◇ Other' },
];

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
];

type Reminder = { channel: ReminderChannel; offsetMinutes: number };

const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: 'At due time', minutes: 0 },
  { label: '15 min before', minutes: -15 },
  { label: '1 hour before', minutes: -60 },
  { label: '1 day before', minutes: -1440 },
];

// Convert ISO to local datetime-local input value (YYYY-MM-DDTHH:mm).
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function TaskForm({
  mode,
  initial,
  team,
  leadId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial: TaskRow | null;
  team: TeamMemberOpt[];
  // If provided (lead detail context), prefills lead and hides lead picker.
  leadId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [kind, setKind] = useState<TaskKind>(initial?.kind ?? 'call');
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'normal');
  const [dueLocal, setDueLocal] = useState(toLocalInput(initial?.dueAt ?? null));
  const [assigneeId, setAssigneeId] = useState<string>(initial?.assigneeId ?? '');
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(
    initial?.recurrence ?? null,
  );
  const [reminders, setReminders] = useState<Reminder[]>(
    initial?.reminders.map((r) => ({ channel: r.channel, offsetMinutes: r.offsetMinutes })) ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function toggleReminder(minutes: number) {
    setReminders((prev) => {
      const idx = prev.findIndex((r) => r.offsetMinutes === minutes && r.channel === 'in_app');
      if (idx >= 0) return prev.filter((_, i) => i !== idx);
      return [...prev, { channel: 'in_app', offsetMinutes: minutes }];
    });
  }

  function isReminderOn(minutes: number) {
    return reminders.some((r) => r.offsetMinutes === minutes);
  }

  function changeReminderChannel(minutes: number, channel: ReminderChannel) {
    setReminders((prev) =>
      prev.map((r) => (r.offsetMinutes === minutes ? { ...r, channel } : r)),
    );
  }

  function setRecurKind(kind: RecurrenceRule['kind'] | null) {
    if (!kind) {
      setRecurrence(null);
      return;
    }
    setRecurrence((prev) =>
      prev ? { ...prev, kind } : { kind, every: 1, endsAt: null, count: null },
    );
  }

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError('Title is required.');
      return;
    }
    setBusy(true);
    startTransition(async () => {
      const dueAt = fromLocalInput(dueLocal);
      const payload = {
        title: title.trim(),
        notes: notes.trim() || null,
        kind,
        priority,
        dueAt,
        assigneeId: assigneeId || null,
        leadId: leadId ?? initial?.leadId ?? null,
        recurrence,
        reminders,
      };
      const res =
        mode === 'edit' && initial
          ? await updateTask(initial.id, payload)
          : await createTask(payload);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40"
      />
      <div className="fixed left-1/2 top-1/2 z-50 w-[520px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-[13.5px] font-semibold">
            {mode === 'edit' ? 'Edit task' : 'New task'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-lg text-txt-3 hover:bg-canvas"
            aria-label="Close"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="max-h-[70vh] space-y-4 overflow-auto p-5">
          <div>
            <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Title
            </label>
            <input
              type="text"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Call back about appointment"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[13px] outline-none focus:border-teal/60"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                Due
              </label>
              <input
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => setDueLocal(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                Assignee
              </label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
              >
                <option value="">Unassigned</option>
                {team.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                Kind
              </label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as TaskKind)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional context"
              className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
            />
          </div>

          <div className="rounded-xl border border-line bg-canvas/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-txt-3">
                Recurrence
              </span>
              <select
                value={recurrence?.kind ?? ''}
                onChange={(e) =>
                  setRecurKind(
                    (e.target.value as RecurrenceRule['kind']) || null,
                  )
                }
                className="rounded-lg border border-line bg-surface px-2 py-1 text-[12px] outline-none focus:border-teal/60"
              >
                <option value="">None</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            {recurrence && (
              <div className="grid grid-cols-3 gap-2 text-[11.5px]">
                <label className="flex items-center gap-1.5">
                  <span className="text-txt-3">every</span>
                  <input
                    type="number"
                    min={1}
                    value={recurrence.every}
                    onChange={(e) =>
                      setRecurrence({
                        ...recurrence,
                        every: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-center"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-txt-3">ends</span>
                  <input
                    type="date"
                    value={recurrence.endsAt ? recurrence.endsAt.slice(0, 10) : ''}
                    onChange={(e) =>
                      setRecurrence({
                        ...recurrence,
                        endsAt: e.target.value ? `${e.target.value}T23:59:59Z` : null,
                      })
                    }
                    className="rounded border border-line bg-surface px-1.5 py-0.5"
                  />
                </label>
                <label className="flex items-center gap-1.5">
                  <span className="text-txt-3">count</span>
                  <input
                    type="number"
                    min={1}
                    placeholder="∞"
                    value={recurrence.count ?? ''}
                    onChange={(e) =>
                      setRecurrence({
                        ...recurrence,
                        count: e.target.value ? Math.max(1, Number(e.target.value)) : null,
                      })
                    }
                    className="w-14 rounded border border-line bg-surface px-1.5 py-0.5 text-center"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-line bg-canvas/40 p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-txt-3">
              Reminders
            </div>
            <div className="space-y-1.5">
              {REMINDER_PRESETS.map((p) => {
                const on = isReminderOn(p.minutes);
                const r = reminders.find((x) => x.offsetMinutes === p.minutes);
                return (
                  <div key={p.minutes} className="flex items-center gap-2 text-[12px]">
                    <label className="flex flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleReminder(p.minutes)}
                        className="h-4 w-4 rounded border-line accent-teal"
                      />
                      <span className={on ? 'text-txt-1' : 'text-txt-2'}>{p.label}</span>
                    </label>
                    {on && (
                      <select
                        value={r?.channel ?? 'in_app'}
                        onChange={(e) =>
                          changeReminderChannel(p.minutes, e.target.value as ReminderChannel)
                        }
                        className="rounded border border-line bg-surface px-1.5 py-0.5 text-[11px] outline-none focus:border-teal/60"
                      >
                        <option value="in_app">In-app</option>
                        <option value="email">Email</option>
                        <option value="sms">SMS</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
            {!fromLocalInput(dueLocal) && reminders.length > 0 && (
              <p className="mt-2 text-[10.5px] text-txt-3">
                Reminders need a due date — they'll save but won't fire until you set one.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
              {error}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas/50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-teal px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : mode === 'edit' ? 'Save' : 'Create task'}
          </button>
        </footer>
      </div>
    </>
  );
}
