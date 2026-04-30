'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import type { Route } from 'next';
import type { TaskFilter, TaskRow } from '@/lib/tasks';
import {
  bulkAssignTasks,
  bulkCompleteTasks,
  bulkDeleteTasks,
  bulkReopenTasks,
} from '@/app/actions/tasks';
import { TaskItem } from './task-item';
import { TaskForm } from './task-form';

export type TeamMemberOpt = { id: string; name: string };

type BulkMode = 'complete' | 'reopen' | 'assign' | 'delete' | null;

const TABS: { key: TaskFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'done', label: 'Done' },
];

export function TasksView({
  activeTab,
  counts,
  tasks,
  team,
}: {
  activeTab: TaskFilter;
  counts: { today: number; overdue: number; upcoming: number };
  tasks: TaskRow[];
  team: TeamMemberOpt[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<BulkMode>(null);

  const allIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && !allSelected;
  const isDoneTab = activeTab === 'done';

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function onBulkDone() {
    clearSelection();
    setBulkMode(null);
    router.refresh();
  }

  function badge(key: TaskFilter) {
    if (key === 'today') return counts.today;
    if (key === 'overdue') return counts.overdue;
    if (key === 'upcoming') return counts.upcoming;
    return null;
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-surface px-6 py-2.5">
        <div className="flex items-center gap-1.5">
          {TABS.map((t) => {
            const active = t.key === activeTab;
            const count = badge(t.key);
            const tone =
              t.key === 'overdue' && (count ?? 0) > 0 && !active
                ? 'text-hp'
                : active
                  ? 'text-teal'
                  : 'text-txt-2';
            return (
              <Link
                key={t.key}
                href={`/tasks?tab=${t.key}` as Route}
                className={`rounded-full px-3 py-1 text-[11.5px] font-medium ${
                  active ? 'bg-teal/15 text-teal' : `bg-canvas hover:bg-canvas/70 ${tone}`
                }`}
              >
                {t.label}
                {count !== null && count > 0 && (
                  <span
                    className={`ml-1.5 text-[10.5px] ${
                      active
                        ? 'text-teal/70'
                        : t.key === 'overdue'
                          ? 'text-hp/80'
                          : 'text-txt-3'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90"
        >
          + New task
        </button>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-teal/10 px-6 py-2">
          <span className="text-[12px] font-medium text-teal">
            {selected.size} selected
          </span>
          <span className="mx-1 h-3 w-px bg-teal/30" />
          {isDoneTab ? (
            <button
              type="button"
              onClick={() => setBulkMode('reopen')}
              className="rounded-md border border-teal/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15"
            >
              Reopen
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setBulkMode('complete')}
              className="rounded-md border border-teal/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15"
            >
              Complete
            </button>
          )}
          <button
            type="button"
            onClick={() => setBulkMode('assign')}
            className="rounded-md border border-teal/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15"
          >
            Reassign
          </button>
          <button
            type="button"
            onClick={() => setBulkMode('delete')}
            className="rounded-md border border-hp/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-hp hover:bg-hp/15"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto rounded-md px-2 py-1 text-[11.5px] text-txt-3 hover:text-txt-1"
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {tasks.length === 0 ? (
          <div className="flex h-full items-center justify-center p-12">
            <div className="max-w-md rounded-lg border border-dashed border-line-2 bg-surface p-8 text-center">
              <p className="text-[12.5px] text-txt-3">
                {activeTab === 'today' && 'No tasks due today. Quiet day.'}
                {activeTab === 'overdue' && 'Nothing overdue. Caught up.'}
                {activeTab === 'upcoming' && 'No upcoming tasks scheduled.'}
                {activeTab === 'done' && 'No completed tasks yet.'}
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line/60 bg-surface px-6 py-1.5">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleAll}
                className="h-3.5 w-3.5 cursor-pointer accent-teal"
              />
              <span className="text-[10.5px] uppercase tracking-wide text-txt-3">
                {allSelected ? 'Deselect all' : 'Select all'}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  team={team}
                  onChanged={refresh}
                  isSelected={selected.has(t.id)}
                  onToggleSelected={() => toggleOne(t.id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      {bulkMode && (
        <BulkTasksModal
          mode={bulkMode}
          ids={Array.from(selected)}
          team={team}
          onClose={() => setBulkMode(null)}
          onDone={onBulkDone}
        />
      )}

      {creating && (
        <TaskForm
          mode="create"
          team={team}
          initial={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

// One dialog component shared by all bulk task actions. Switches body
// per `mode` and dispatches the matching server action.
function BulkTasksModal({
  mode,
  ids,
  team,
  onClose,
  onDone,
}: {
  mode: Exclude<BulkMode, null>;
  ids: string[];
  team: TeamMemberOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Empty string => unassign (server action takes null).
  const [assigneeId, setAssigneeId] = useState<string>(team[0]?.id ?? '');
  const [confirmText, setConfirmText] = useState('');

  function run() {
    setError(null);
    startTransition(async () => {
      let res: { ok: true; count: number } | { ok: false; error: string };
      if (mode === 'complete') {
        res = await bulkCompleteTasks({ ids });
      } else if (mode === 'reopen') {
        res = await bulkReopenTasks({ ids });
      } else if (mode === 'assign') {
        res = await bulkAssignTasks({ ids, assigneeId: assigneeId === '' ? null : assigneeId });
      } else {
        if (confirmText.trim().toLowerCase() !== 'delete') {
          setError('Type "delete" to confirm.');
          return;
        }
        res = await bulkDeleteTasks({ ids });
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  const noun = `${ids.length} task${ids.length === 1 ? '' : 's'}`;
  const title =
    mode === 'complete'
      ? `Complete ${noun}`
      : mode === 'reopen'
        ? `Reopen ${noun}`
        : mode === 'assign'
          ? `Reassign ${noun}`
          : `Delete ${noun}`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-[14px] font-semibold text-txt-1">{title}</div>

        {(mode === 'complete' || mode === 'reopen') && (
          <p className="text-[12.5px] text-txt-2">
            {mode === 'complete'
              ? 'Mark every selected task as done. Recurring tasks will not auto-spawn next occurrences in bulk — close those individually if needed.'
              : 'Reopen every selected task and clear its completion timestamp.'}
          </p>
        )}

        {mode === 'assign' && (
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-teal/60"
          >
            <option value="">— Unassigned —</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}

        {mode === 'delete' && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-txt-2">
              This permanently removes the selected tasks. Type{' '}
              <span className="font-mono font-semibold">delete</span> to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete"
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-hp/60"
            />
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50 ${
              mode === 'delete' ? 'bg-hp hover:bg-hp/90' : 'bg-teal hover:bg-teal/90'
            }`}
          >
            {pending ? 'Working…' : mode === 'delete' ? 'Delete tasks' : 'Apply'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-line px-3 py-2 text-[13px] text-txt-2 hover:bg-canvas"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
