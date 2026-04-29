'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Route } from 'next';
import type { TaskFilter, TaskRow } from '@/lib/tasks';
import { TaskItem } from './task-item';
import { TaskForm } from './task-form';

export type TeamMemberOpt = { id: string; name: string };

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
          <ul className="divide-y divide-line">
            {tasks.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                team={team}
                onChanged={refresh}
              />
            ))}
          </ul>
        )}
      </div>

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
