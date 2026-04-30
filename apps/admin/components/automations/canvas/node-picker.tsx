'use client';

// Modal that picks a node type to insert. Each option seeds a default
// data object so the resulting node is immediately valid (no dangling
// required fields). The caller swaps a handle/edge for the new node and
// reroutes incoming/outgoing edges as needed.

import type { GraphNode, AutomationAction, BranchCondition } from '@/lib/automation-types';

export type PickerKind = 'action' | 'branch' | 'wait';

const COMM_ACCENT = 'bg-sky-500/15 text-sky-600 dark:text-sky-400';
const DATA_ACCENT = 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400';
const INTEGRATION_ACCENT = 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400';
const ACTION_ACCENT = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
const LOGIC_ACCENT = 'bg-violet-500/15 text-violet-600 dark:text-violet-400';
const WAIT_ACCENT = 'bg-amber-500/15 text-amber-600 dark:text-amber-400';

const OPTIONS: Array<{
  group: string;
  items: Array<{
    kind: PickerKind;
    actionKind?: AutomationAction['kind'];
    branchKind?: BranchCondition['kind'];
    label: string;
    description: string;
    accent: string;
    icon: React.ReactNode;
  }>;
}> = [
  {
    group: 'Communication',
    items: [
      {
        kind: 'action',
        actionKind: 'send_email',
        label: 'Send email',
        description: 'Email the lead or a specific address (queued for sending).',
        accent: COMM_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="M3 7l9 7 9-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        kind: 'action',
        actionKind: 'send_sms',
        label: 'Send SMS',
        description: "Text the lead or a specific phone number.",
        accent: COMM_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        kind: 'action',
        actionKind: 'send_notification',
        label: 'Notify team',
        description: 'In-app notification to caller, lead owner, role, or member.',
        accent: COMM_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
  {
    group: 'Lead actions',
    items: [
      {
        kind: 'action',
        actionKind: 'move_stage',
        label: 'Move stage',
        description: 'Send the lead to a different pipeline stage.',
        accent: ACTION_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        kind: 'action',
        actionKind: 'add_tag',
        label: 'Add tag',
        description: 'Tag the lead for filtering / segmentation.',
        accent: ACTION_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20.59 13.41L13.42 20.58a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
          </svg>
        ),
      },
      {
        kind: 'action',
        actionKind: 'mark_dnc',
        label: 'Mark Do Not Call',
        description: "Set the lead's do_not_call flag.",
        accent: ACTION_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M5 5l14 14" />
          </svg>
        ),
      },
      {
        kind: 'action',
        actionKind: 'create_task',
        label: 'Create task',
        description: 'Schedule a task on the lead for an agent.',
        accent: ACTION_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M9 11l3 3L22 4" />
          </svg>
        ),
      },
      {
        kind: 'action',
        actionKind: 'update_lead_field',
        label: 'Update lead field',
        description: 'Set a lead field (name, email, phone, notes, custom).',
        accent: DATA_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4z" strokeLinejoin="round" />
          </svg>
        ),
      },
    ],
  },
  {
    group: 'Integration',
    items: [
      {
        kind: 'action',
        actionKind: 'http_request',
        label: 'HTTP request',
        description: 'Outbound webhook (POST/GET/PUT/PATCH/DELETE).',
        accent: INTEGRATION_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
          </svg>
        ),
      },
    ],
  },
  {
    group: 'Logic',
    items: [
      {
        kind: 'branch',
        branchKind: 'disposition_equals',
        label: 'Branch — disposition',
        description: 'Different paths based on the call disposition.',
        accent: LOGIC_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 6h2l5 12h4M9 18l5-12h7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        kind: 'branch',
        branchKind: 'lead_in_stage',
        label: 'Branch — lead stage',
        description: "Check the lead's current pipeline stage.",
        accent: LOGIC_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 6h2l5 12h4M9 18l5-12h7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        kind: 'branch',
        branchKind: 'lead_has_tag',
        label: 'Branch — has tag',
        description: 'Check whether the lead carries a specific tag.',
        accent: LOGIC_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3 6h2l5 12h4M9 18l5-12h7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ),
      },
      {
        kind: 'wait',
        label: 'Wait',
        description: 'Pause the workflow for a fixed amount of time.',
        accent: WAIT_ACCENT,
        icon: (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" strokeLinecap="round" />
          </svg>
        ),
      },
    ],
  },
];

export function NodePicker({
  ctx,
  onCancel,
  onPick,
}: {
  ctx: { stages: { id: string; name: string }[]; tags: { id: string; name: string }[] };
  onCancel: () => void;
  onPick: (node: Omit<GraphNode, 'id' | 'position'>) => void;
}) {
  function pick(opt: (typeof OPTIONS)[number]['items'][number]) {
    if (opt.kind === 'action') {
      const k = opt.actionKind!;
      let action: AutomationAction;
      switch (k) {
        case 'move_stage':
          action = { kind: 'move_stage', stage_id: ctx.stages[0]?.id ?? '' };
          break;
        case 'mark_dnc':
          action = { kind: 'mark_dnc' };
          break;
        case 'add_tag':
          action = { kind: 'add_tag', tag_id: ctx.tags[0]?.id ?? '' };
          break;
        case 'create_task':
          action = {
            kind: 'create_task',
            title: 'Follow up',
            task_kind: 'call',
            assign_to_caller: true,
          };
          break;
        case 'send_email':
          action = {
            kind: 'send_email',
            to: 'lead',
            subject: 'Following up',
            body: 'Hi {{lead.first_name}},\n\n',
          };
          break;
        case 'send_sms':
          action = {
            kind: 'send_sms',
            to: 'lead',
            body: 'Hi {{lead.first_name}}, ',
          };
          break;
        case 'send_notification':
          action = {
            kind: 'send_notification',
            recipient_kind: 'caller',
            title: 'Workflow update',
          };
          break;
        case 'http_request':
          action = {
            kind: 'http_request',
            method: 'POST',
            url: '',
            headers: [],
            body_template: '{}',
          };
          break;
        case 'update_lead_field':
          action = { kind: 'update_lead_field', field: 'first_name', value: '' };
          break;
        default:
          return;
      }
      onPick({ type: 'action', data: { action } });
      return;
    }
    if (opt.kind === 'branch') {
      const bk = opt.branchKind!;
      let condition: BranchCondition;
      switch (bk) {
        case 'disposition_equals':
          condition = { kind: 'disposition_equals', codes: [] };
          break;
        case 'lead_in_stage':
          condition = { kind: 'lead_in_stage', stage_id: ctx.stages[0]?.id ?? '' };
          break;
        case 'lead_has_tag':
          condition = { kind: 'lead_has_tag', tag_id: ctx.tags[0]?.id ?? '' };
          break;
        case 'lead_field_equals':
          condition = { kind: 'lead_field_equals', field: 'do_not_call', value: true };
          break;
      }
      onPick({ type: 'branch', data: { condition } });
      return;
    }
    if (opt.kind === 'wait') {
      onPick({ type: 'wait', data: { duration_minutes: 5 } });
      return;
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold">Add step</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-canvas hover:text-txt-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {OPTIONS.map((g) => (
            <div key={g.group} className="px-2 py-2">
              <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                {g.group}
              </div>
              <div className="space-y-1">
                {g.items.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pick(opt)}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-canvas"
                  >
                    <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${opt.accent}`}>
                      {opt.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium">{opt.label}</div>
                      <div className="truncate text-[11px] text-txt-3">{opt.description}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
