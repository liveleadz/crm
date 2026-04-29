'use client';

import { useCallback, useEffect, useState } from 'react';
import { getBrandTeam, getLeadTasks } from '@/app/actions/tasks';
import type { TaskRow } from '@/lib/tasks';
import { TaskItem } from './task-item';
import { TaskForm } from './task-form';
import type { TeamMemberOpt } from './tasks-view';

export function LeadTasksPanel({ leadId }: { leadId: string }) {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [team, setTeam] = useState<TeamMemberOpt[]>([]);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    const t = await getLeadTasks(leadId);
    setTasks(t);
  }, [leadId]);

  useEffect(() => {
    refresh();
    getBrandTeam().then(setTeam);
  }, [refresh]);

  const open = tasks?.filter((t) => t.status === 'open') ?? [];
  const done = tasks?.filter((t) => t.status === 'done') ?? [];

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-txt-3">
          Tasks
        </h4>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-txt-2 hover:bg-surface-2"
        >
          + Add
        </button>
      </div>
      {tasks === null ? (
        <p className="text-[12px] text-txt-3">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="text-[12px] text-txt-3">No tasks yet for this lead.</p>
      ) : (
        <ul className="-mx-5 divide-y divide-line">
          {open.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              team={team}
              hideLead
              onChanged={refresh}
            />
          ))}
          {done.length > 0 && (
            <li className="px-5 pt-2 text-[10.5px] uppercase tracking-wide text-txt-3">
              Completed
            </li>
          )}
          {done.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              team={team}
              hideLead
              onChanged={refresh}
            />
          ))}
        </ul>
      )}

      {creating && (
        <TaskForm
          mode="create"
          team={team}
          initial={null}
          leadId={leadId}
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
