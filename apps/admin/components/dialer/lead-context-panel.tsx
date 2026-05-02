'use client';

// Lead context panel shown during the call. Tabs across recent calls,
// open tasks, and upcoming appointments. Loads on demand via the
// loadDialerContext server action and caches per leadId so re-rendering
// the same lead doesn't refetch.

import { useEffect, useState, useTransition } from 'react';
import { loadDialerContext } from '@/app/actions/dialer-context';
import type { LeadCallContext } from '@/lib/lead-context';

type Tab = 'calls' | 'tasks' | 'upcoming';

export function LeadContextPanel({ leadId }: { leadId: string }) {
  const [ctx, setCtx] = useState<LeadCallContext | null>(null);
  const [tab, setTab] = useState<Tab>('calls');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCtx(null);
    setError(null);
    startTransition(async () => {
      const res = await loadDialerContext(leadId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCtx(res.context);
    });
  }, [leadId]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="mb-3 w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-[11.5px] text-txt-3 hover:border-line-2 hover:text-txt-2"
      >
        Show lead history
      </button>
    );
  }

  return (
    <div className="mb-3 rounded-xl border border-line bg-canvas">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-3 text-[11px]">
          <button
            type="button"
            onClick={() => setTab('calls')}
            className={`font-medium ${tab === 'calls' ? 'text-txt-1' : 'text-txt-3 hover:text-txt-2'}`}
          >
            Calls{ctx ? ` · ${ctx.recentCalls.length}` : ''}
          </button>
          <button
            type="button"
            onClick={() => setTab('tasks')}
            className={`font-medium ${tab === 'tasks' ? 'text-txt-1' : 'text-txt-3 hover:text-txt-2'}`}
          >
            Tasks{ctx ? ` · ${ctx.openTasks.length}` : ''}
          </button>
          <button
            type="button"
            onClick={() => setTab('upcoming')}
            className={`font-medium ${tab === 'upcoming' ? 'text-txt-1' : 'text-txt-3 hover:text-txt-2'}`}
          >
            Upcoming{ctx ? ` · ${ctx.upcomingAppointments.length}` : ''}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/leads/${leadId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10.5px] text-txt-3 hover:text-teal"
          >
            View profile ↗
          </a>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Hide"
            className="text-[10.5px] text-txt-3 hover:text-txt-2"
          >
            Hide
          </button>
        </div>
      </div>

      {ctx && (ctx.stage || ctx.tags.length > 0 || ctx.notes) && (
        <div className="border-b border-line px-3 py-2">
          {ctx.stage && (
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-medium text-txt-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: ctx.stage.color ?? 'var(--color-line-2)' }}
              />
              {ctx.stage.name}
            </div>
          )}
          {ctx.tags.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {ctx.tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full border border-line bg-surface px-2 py-0.5 text-[10.5px] text-txt-2"
                  style={t.color ? { borderColor: t.color, color: t.color } : undefined}
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {ctx.notes && (
            <p className="mt-1 text-[11.5px] leading-snug text-txt-2 whitespace-pre-wrap">
              {ctx.notes}
            </p>
          )}
        </div>
      )}

      <div className="px-3 py-2 text-[12px]">
        {pending && !ctx && <p className="text-[11.5px] text-txt-3">Loading…</p>}
        {error && <p className="text-[11.5px] text-hp">{error}</p>}
        {ctx && tab === 'calls' && <CallsList calls={ctx.recentCalls} />}
        {ctx && tab === 'tasks' && <TasksList tasks={ctx.openTasks} />}
        {ctx && tab === 'upcoming' && <ApptsList appts={ctx.upcomingAppointments} />}
      </div>
    </div>
  );
}

function CallsList({ calls }: { calls: LeadCallContext['recentCalls'] }) {
  if (calls.length === 0) return <Empty label="No prior calls" />;
  return (
    <ul className="space-y-1">
      {calls.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 text-[11.5px]">
          <span className="flex items-center gap-1.5 truncate text-txt-2">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                c.direction === 'inbound' ? 'bg-teal' : 'bg-line-2'
              }`}
            />
            {relTime(c.startedAt)} ·{' '}
            <span className="capitalize">{c.disposition ?? 'no disposition'}</span>
          </span>
          <span className="shrink-0 font-mono text-[10.5px] text-txt-3">
            {formatDur(c.durationSec)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TasksList({ tasks }: { tasks: LeadCallContext['openTasks'] }) {
  if (tasks.length === 0) return <Empty label="No open tasks" />;
  return (
    <ul className="space-y-1">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-2 text-[11.5px]">
          <span className="truncate text-txt-2">
            <span className="capitalize text-txt-3">{t.kind}</span> · {t.title}
          </span>
          {t.dueAt && (
            <span className="shrink-0 text-[10.5px] text-txt-3">{relTime(t.dueAt)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function ApptsList({ appts }: { appts: LeadCallContext['upcomingAppointments'] }) {
  if (appts.length === 0) return <Empty label="No upcoming appointments" />;
  return (
    <ul className="space-y-1">
      {appts.map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-2 text-[11.5px]">
          <span className="truncate text-txt-2">{a.title}</span>
          <span className="shrink-0 text-[10.5px] text-txt-3">{relTime(a.startsAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="text-[11.5px] text-txt-3">{label}</p>;
}

function formatDur(s: number | null): string {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const r = (s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
}

// Compact relative time. Past = "3d ago"; future = "in 2h".
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = t - Date.now();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  const hr = Math.round(abs / 3_600_000);
  const day = Math.round(abs / 86_400_000);
  let label: string;
  if (min < 60) label = `${min}m`;
  else if (hr < 24) label = `${hr}h`;
  else label = `${day}d`;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}
