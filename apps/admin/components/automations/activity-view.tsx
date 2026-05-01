'use client';

// Read-only feed of executed actions for this automation. Sourced from the
// action_log table written by both simple-mode and graph-mode runs.

import Link from 'next/link';
import type { ActionLogRow } from '@/lib/action-log';

type Props = { rows: ActionLogRow[] };

export function ActivityView({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="rounded-xl border border-dashed border-line bg-surface px-8 py-10 text-center">
          <p className="text-[13px] font-medium">No activity yet</p>
          <p className="mt-1 text-[12px] text-txt-3">
            Once this automation fires, every executed action shows up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mx-auto max-w-3xl space-y-1">
        {rows.map((r) => (
          <ActivityRow key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}

function ActivityRow({ row }: { row: ActionLogRow }) {
  const time = new Date(row.createdAt);
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
      <StatusDot status={row.status} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="font-medium">{labelAction(row.actionKind)}</span>
          <span className="text-txt-3">·</span>
          <span className="text-txt-3">{labelTrigger(row.triggerType)}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-txt-3">
          {row.lead ? (
            <Link href={{ pathname: `/leads/${row.lead.id}` }} className="hover:text-txt-1">
              {row.lead.name}
            </Link>
          ) : (
            <span>—</span>
          )}
          {row.detail && Object.keys(row.detail).length > 0 && (
            <>
              <span>·</span>
              <span className="truncate">{summarizeDetail(row.detail)}</span>
            </>
          )}
        </div>
      </div>
      <div className="text-right text-[11px] text-txt-3" title={time.toLocaleString()}>
        {relativeTime(time)}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: 'ok' | 'skipped' | 'failed' }) {
  const map = {
    ok: 'bg-emerald-500',
    skipped: 'bg-amber-500',
    failed: 'bg-hp',
  } as const;
  return <span className={`h-2 w-2 shrink-0 rounded-full ${map[status]}`} />;
}

function labelAction(kind: string): string {
  switch (kind) {
    case 'move_stage':
      return 'Move stage';
    case 'mark_dnc':
      return 'Mark Do Not Call';
    case 'add_tag':
      return 'Add tag';
    case 'create_task':
      return 'Create task';
    case 'send_email':
      return 'Send email';
    case 'send_sms':
      return 'Send SMS';
    case 'send_notification':
      return 'Notify team';
    case 'http_request':
      return 'HTTP request';
    case 'update_lead_field':
      return 'Update lead field';
    case 'create_contact':
      return 'Create contact';
    default:
      return kind;
  }
}

function labelTrigger(t: string): string {
  switch (t) {
    case 'disposition_set':
      return 'disposition';
    case 'webhook_received':
      return 'webhook';
    case 'call_received':
      return 'inbound call';
    case 'lead_created':
      return 'lead created';
    case 'stage_changed':
      return 'stage changed';
    case 'email_received':
      return 'email received';
    case 'appointment_booked':
      return 'appointment booked';
    default:
      return t;
  }
}

function summarizeDetail(detail: Record<string, unknown>): string {
  if (typeof detail.error === 'string' && detail.error) return detail.error;
  if (typeof detail.reason === 'string' && detail.reason) return detail.reason;
  // Fallback: show first key=value pair.
  const entries = Object.entries(detail);
  if (entries.length === 0) return '';
  const first = entries[0];
  if (!first) return '';
  const [k, v] = first;
  if (v == null) return k;
  if (typeof v === 'object') return k;
  return `${k}: ${String(v)}`;
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}
