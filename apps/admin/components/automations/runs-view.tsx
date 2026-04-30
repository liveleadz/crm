'use client';

// Runs tab on the automation editor. Lists recent workflow_runs rows for the
// active automation so the author can debug what fired, what's parked on a
// wait, and what failed (and where).

import { useState } from 'react';
import type { WorkflowRunRow, WorkflowRunStatus } from '@/lib/workflow-runs';

export function RunsView({ runs }: { runs: WorkflowRunRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (runs.length === 0) {
    return (
      <div className="grid h-full place-items-center p-12 text-center">
        <div className="max-w-md space-y-2">
          <p className="text-[14px] font-medium text-txt-1">No runs yet.</p>
          <p className="text-[12.5px] text-txt-3">
            Once this workflow fires — by call disposition, webhook, or a manual test — every
            run will land here with its current step, status, and error trace.
          </p>
        </div>
      </div>
    );
  }

  // Quick rollup at the top so the author sees the overall health without
  // counting rows.
  const counts = {
    completed: runs.filter((r) => r.status === 'completed').length,
    waiting: runs.filter((r) => r.status === 'waiting').length,
    running: runs.filter((r) => r.status === 'running').length,
    failed: runs.filter((r) => r.status === 'failed').length,
    cancelled: runs.filter((r) => r.status === 'cancelled').length,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line bg-canvas px-6 py-3 text-[12px] text-txt-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-txt-2">{runs.length} recent runs</span>
          <Pill label="Completed" value={counts.completed} tone="emerald" />
          <Pill label="Waiting" value={counts.waiting} tone="amber" />
          <Pill label="Running" value={counts.running} tone="teal" />
          <Pill label="Failed" value={counts.failed} tone="hp" />
          {counts.cancelled > 0 && <Pill label="Cancelled" value={counts.cancelled} tone="line" />}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
          <colgroup>
            <col style={{ width: 110 }} />
            <col style={{ width: 220 }} />
            <col />
            <col style={{ width: 200 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead className="border-b border-line bg-canvas text-[11px] uppercase tracking-wide text-txt-3">
            <tr>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Lead</th>
              <th className="px-4 py-2 font-medium">Current step</th>
              <th className="px-4 py-2 font-medium">Started</th>
              <th className="px-4 py-2 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <RunRow
                key={r.id}
                run={r}
                expanded={expanded === r.id}
                onToggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunRow({
  run,
  expanded,
  onToggle,
}: {
  run: WorkflowRunRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-line/50 hover:bg-canvas ${
          expanded ? 'bg-canvas' : ''
        }`}
      >
        <td className="px-4 py-3">
          <StatusBadge status={run.status} />
        </td>
        <td className="px-4 py-3 truncate" title={run.lead?.name ?? ''}>
          {run.lead ? (
            <div className="min-w-0">
              <div className="truncate text-[12.5px]">{run.lead.name}</div>
              {run.lead.phone && (
                <div className="font-mono text-[10.5px] text-txt-3">{run.lead.phone}</div>
              )}
            </div>
          ) : (
            <span className="text-txt-3">—</span>
          )}
        </td>
        <td className="px-4 py-3 truncate" title={run.currentNodeLabel}>
          {run.currentNodeLabel}
        </td>
        <td className="px-4 py-3 text-txt-2">
          {run.startedAt ? (
            <>
              <div>{formatDateTime(run.startedAt)}</div>
              <div className="text-[10.5px] text-txt-3">{timeAgo(run.startedAt)}</div>
            </>
          ) : (
            <span className="text-txt-3">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-txt-2">{durationLabel(run)}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-line bg-canvas/60">
          <td colSpan={5} className="px-4 py-3">
            <div className="grid gap-3 text-[12px] sm:grid-cols-2">
              <DetailField label="Run id" value={<code className="font-mono text-[11px]">{run.id}</code>} />
              <DetailField
                label="Trigger"
                value={
                  <>
                    <code className="font-mono text-[11px]">{run.triggerKind ?? 'unknown'}</code>
                    {run.triggerDisposition && (
                      <span className="ml-1.5 text-[11px] text-txt-3">
                        · {run.triggerDisposition}
                      </span>
                    )}
                  </>
                }
              />
              <DetailField
                label="Started at"
                value={run.startedAt ? formatDateTime(run.startedAt) : '—'}
              />
              <DetailField
                label="Finished at"
                value={run.finishedAt ? formatDateTime(run.finishedAt) : '—'}
              />
              {run.status === 'waiting' && run.nextRunAt && (
                <DetailField label="Resumes" value={`${formatDateTime(run.nextRunAt)} (${timeUntil(run.nextRunAt)})`} />
              )}
              <DetailField
                label="Step id"
                value={
                  run.currentNodeId ? (
                    <code className="font-mono text-[11px]">{run.currentNodeId}</code>
                  ) : (
                    '—'
                  )
                }
              />
              {run.error && (
                <div className="sm:col-span-2">
                  <div className="text-[10.5px] uppercase tracking-wide text-txt-3">Error</div>
                  <div className="mt-1 rounded-lg border border-hp/30 bg-hp/5 px-3 py-2 font-mono text-[11.5px] text-hp">
                    {run.error}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: WorkflowRunStatus }) {
  const tone =
    status === 'completed'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : status === 'waiting'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : status === 'running'
          ? 'bg-teal/15 text-teal'
          : status === 'failed'
            ? 'bg-hp/15 text-hp'
            : 'bg-canvas text-txt-3';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {status}
    </span>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'teal' | 'hp' | 'line';
}) {
  const cls =
    tone === 'emerald'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : tone === 'teal'
          ? 'border-teal/30 bg-teal/10 text-teal'
          : tone === 'hp'
            ? 'border-hp/30 bg-hp/10 text-hp'
            : 'border-line bg-canvas text-txt-3';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-wide text-txt-3">{label}</div>
      <div className="mt-0.5 text-[12px] text-txt-1">{value}</div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function durationLabel(run: WorkflowRunRow): string {
  if (!run.startedAt) return '—';
  const start = new Date(run.startedAt).getTime();
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function timeUntil(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = t - Date.now();
  if (diff <= 0) return 'now';
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}
