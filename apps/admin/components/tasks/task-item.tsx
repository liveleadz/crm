'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import type { Route } from 'next';
import {
  completeTask,
  deleteTask,
  reopenTask,
  snoozeTask,
} from '@/app/actions/tasks';
import type { TaskKind, TaskPriority, TaskRow } from '@/lib/tasks';
import { TaskForm } from './task-form';
import type { TeamMemberOpt } from './tasks-view';
import { TagChip } from '@/components/tags/tag-chip';

const KIND_ICON: Record<TaskKind, string> = {
  call: '📞',
  text: '💬',
  email: '✉️',
  meeting: '📅',
  note: '📝',
  other: '◇',
};

const PRIORITY_TONE: Record<TaskPriority, string> = {
  low: 'bg-canvas text-txt-3',
  normal: 'bg-canvas text-txt-2',
  high: 'bg-hp/15 text-hp',
};

const RECUR_LABEL: Record<string, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};

function formatDue(iso: string | null): { label: string; tone: string } {
  if (!iso) return { label: 'No due date', tone: 'text-txt-3' };
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const isPast = diffMs < 0;
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  if (isToday) return { label: `Today ${time}`, tone: isPast ? 'text-hp' : 'text-teal' };
  if (isPast) {
    const days = Math.ceil(-diffMs / (24 * 60 * 60 * 1000));
    return { label: `${days}d overdue`, tone: 'text-hp' };
  }
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return { label: `${dateStr} ${time}`, tone: 'text-txt-2' };
}

export function TaskItem({
  task,
  team,
  onChanged,
  hideLead = false,
  isSelected,
  onToggleSelected,
}: {
  task: TaskRow;
  team: TeamMemberOpt[];
  onChanged: () => void;
  hideLead?: boolean;
  // Optional checkbox slot for bulk-select on /tasks. Omit to render
  // without a checkbox (e.g. inside the lead detail drawer).
  isSelected?: boolean;
  onToggleSelected?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();
  const due = formatDue(task.dueAt);
  const isDone = task.status === 'done';

  function run(fn: () => Promise<{ ok: boolean }>) {
    setBusy(true);
    startTransition(async () => {
      await fn();
      setBusy(false);
      onChanged();
    });
  }

  function snooze(hours: number) {
    const base =
      task.dueAt && new Date(task.dueAt) > new Date() ? new Date(task.dueAt) : new Date();
    const target = new Date(base.getTime() + hours * 60 * 60 * 1000);
    run(() => snoozeTask(task.id, target.toISOString()));
  }

  function snoozeToTomorrow() {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
    run(() => snoozeTask(task.id, t.toISOString()));
  }

  return (
    <li className={`group flex items-start gap-3 px-6 py-3 hover:bg-surface/50 ${isSelected ? 'bg-teal/5' : ''}`}>
      {onToggleSelected && (
        <input
          type="checkbox"
          aria-label={`Select ${task.title}`}
          checked={!!isSelected}
          onChange={onToggleSelected}
          className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-teal"
        />
      )}
      <button
        type="button"
        onClick={() => run(() => (isDone ? reopenTask(task.id) : completeTask(task.id)))}
        disabled={busy}
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
          isDone
            ? 'border-ll bg-ll text-white'
            : 'border-line hover:border-teal/60 hover:bg-teal/10'
        } disabled:opacity-50`}
        aria-label={isDone ? 'Reopen task' : 'Complete task'}
        title={isDone ? 'Reopen' : 'Mark done'}
      >
        {isDone && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[12px]" aria-hidden>
            {KIND_ICON[task.kind]}
          </span>
          <span
            className={`truncate text-[12.5px] font-medium ${
              isDone ? 'text-txt-3 line-through' : 'text-txt-1'
            }`}
          >
            {task.title}
          </span>
          {task.recurrence && (
            <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] text-txt-3">
              ↻ every {task.recurrence.every === 1 ? '' : `${task.recurrence.every} `}
              {RECUR_LABEL[task.recurrence.kind] ?? task.recurrence.kind}
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
          <span className={due.tone}>{due.label}</span>
          {task.priority !== 'normal' && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-medium capitalize ${PRIORITY_TONE[task.priority]}`}
            >
              {task.priority}
            </span>
          )}
          {!hideLead && task.leadId && (
            <Link
              href={`/leads/${task.leadId}` as Route}
              className="text-txt-3 hover:text-txt-1 hover:underline"
            >
              {task.leadName ?? 'Lead'}
            </Link>
          )}
          {!hideLead && task.leadTags.length > 0 && (
            <span className="flex flex-wrap items-center gap-1">
              {task.leadTags.slice(0, 3).map((t) => (
                <TagChip key={t.id} name={t.name} color={t.color} size="xs" />
              ))}
              {task.leadTags.length > 3 && (
                <span className="text-[10px] text-txt-3">+{task.leadTags.length - 3}</span>
              )}
            </span>
          )}
          {task.assigneeName && (
            <span className="text-txt-3">→ {task.assigneeName}</span>
          )}
          {task.reminders.length > 0 && (
            <span className="text-txt-3" title={`${task.reminders.length} reminder(s)`}>
              🔔 {task.reminders.length}
            </span>
          )}
          {task.snoozedUntil && new Date(task.snoozedUntil) > new Date() && (
            <span className="text-bs">💤 snoozed</span>
          )}
        </div>
        {task.notes && (
          <p className="mt-1 line-clamp-2 text-[11.5px] text-txt-3">{task.notes}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100">
        {!isDone && (
          <>
            <button
              type="button"
              onClick={() => snooze(1)}
              disabled={busy}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-txt-3 hover:bg-canvas hover:text-txt-1"
              title="Snooze 1 hour"
            >
              +1h
            </button>
            <button
              type="button"
              onClick={() => snooze(3)}
              disabled={busy}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-txt-3 hover:bg-canvas hover:text-txt-1"
              title="Snooze 3 hours"
            >
              +3h
            </button>
            <button
              type="button"
              onClick={snoozeToTomorrow}
              disabled={busy}
              className="rounded px-1.5 py-0.5 text-[10.5px] text-txt-3 hover:bg-canvas hover:text-txt-1"
              title="Snooze to tomorrow 9am"
            >
              tmrw
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded px-1.5 py-0.5 text-[10.5px] text-txt-3 hover:bg-canvas hover:text-txt-1"
          title="Edit"
        >
          edit
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm('Delete this task?')) run(() => deleteTask(task.id));
          }}
          disabled={busy}
          className="rounded px-1.5 py-0.5 text-[10.5px] text-txt-3 hover:bg-hp/10 hover:text-hp"
          title="Delete"
        >
          ×
        </button>
      </div>

      {editing && (
        <TaskForm
          mode="edit"
          team={team}
          initial={task}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}
