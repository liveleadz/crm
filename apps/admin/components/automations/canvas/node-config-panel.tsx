'use client';

// Right-side panel that edits the currently selected node. Renders a
// per-type form that mutates the underlying GraphNode via onChange. The
// canvas itself owns the node state — this panel is dumb.

import { useState, useTransition } from 'react';
import { regenerateWebhookToken } from '@/app/actions/automations';
import type {
  AutomationAction,
  BranchCondition,
  GraphNode,
  HttpMethod,
  LeadFieldKey,
  MemberRole,
  WaitMode,
  WaitNodeData,
} from '@/lib/automation-types';

type Props = {
  node: GraphNode;
  ctx: {
    stages: { id: string; name: string }[];
    tags: { id: string; name: string }[];
    dispositions: { code: string; label: string }[];
    members?: { id: string; full_name: string | null; email: string }[];
    automation?: { id: string; webhookToken: string | null };
  };
  onChange: (next: GraphNode) => void;
  onDelete: () => void;
  onClose: () => void;
};

export function NodeConfigPanel({ node, ctx, onChange, onDelete, onClose }: Props) {
  return (
    <div className="absolute right-0 top-0 z-30 flex h-full w-[340px] flex-col border-l border-line bg-surface shadow-lg">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="text-[13px] font-semibold">{titleForNode(node)}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-canvas hover:text-txt-1"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {node.type === 'trigger' && <TriggerEditor node={node} ctx={ctx} onChange={onChange} />}
        {node.type === 'action' && <ActionEditor node={node} ctx={ctx} onChange={onChange} />}
        {node.type === 'branch' && <BranchEditor node={node} ctx={ctx} onChange={onChange} />}
        {node.type === 'wait' && <WaitEditor node={node} onChange={onChange} />}
        {node.type === 'end' && (
          <p className="text-[12px] text-txt-3">
            End nodes terminate this branch of the workflow.
          </p>
        )}
      </div>

      {node.type !== 'trigger' && (
        <div className="border-t border-line p-3">
          <button
            type="button"
            onClick={onDelete}
            className="w-full rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] font-medium text-hp hover:bg-hp/20"
          >
            Delete step
          </button>
        </div>
      )}
    </div>
  );
}

function titleForNode(node: GraphNode): string {
  switch (node.type) {
    case 'trigger':
      return 'Trigger';
    case 'action':
      return 'Action';
    case 'branch':
      return 'Condition';
    case 'wait':
      return 'Wait';
    case 'end':
      return 'End';
  }
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

function TriggerEditor({
  node,
  ctx,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'trigger' }>;
  ctx: Props['ctx'];
  onChange: (n: GraphNode) => void;
}) {
  const triggerType = node.data.trigger_type;
  function setKind(kind: string) {
    let config: Record<string, unknown> = {};
    if (kind === 'disposition_set') config = { codes: [] };
    else if (kind === 'lead_created') config = { source_in: [] };
    else if (kind === 'stage_changed') config = { to_stage_in: [], from_stage_in: [] };
    else if (kind === 'task_completed') config = { task_kind_in: [] };
    else if (kind === 'call_ended') config = { direction_in: [] };
    else if (kind === 'tag_added') config = { tag_in: [] };
    onChange({
      ...node,
      data: {
        trigger_type: kind,
        trigger_config: config,
      },
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Trigger type</Label>
        <select value={triggerType} onChange={(e) => setKind(e.target.value)} className={inputCls}>
          <option value="disposition_set">When call disposition is set</option>
          <option value="call_received">When inbound call is received</option>
          <option value="webhook_received">When webhook is received</option>
          <option value="lead_created">When a lead is created</option>
          <option value="stage_changed">When a lead stage changes</option>
          <option value="email_received">When an inbound email is received</option>
          <option value="appointment_booked">When an appointment is booked</option>
          <option value="task_completed">When a task is completed</option>
          <option value="call_ended">When a call ends</option>
          <option value="tag_added">When a tag is added to a lead</option>
        </select>
      </div>

      {triggerType === 'disposition_set' && (
        <DispositionTriggerFields node={node} ctx={ctx} onChange={onChange} />
      )}
      {triggerType === 'call_received' && <CallReceivedTriggerFields />}
      {triggerType === 'webhook_received' && <WebhookTriggerFields ctx={ctx} />}
      {triggerType === 'lead_created' && (
        <LeadCreatedTriggerFields node={node} onChange={onChange} />
      )}
      {triggerType === 'stage_changed' && (
        <StageChangedTriggerFields node={node} ctx={ctx} onChange={onChange} />
      )}
      {triggerType === 'email_received' && <EmailReceivedTriggerFields />}
      {triggerType === 'appointment_booked' && <AppointmentBookedTriggerFields />}
      {triggerType === 'task_completed' && (
        <TaskCompletedTriggerFields node={node} onChange={onChange} />
      )}
      {triggerType === 'call_ended' && (
        <CallEndedTriggerFields node={node} onChange={onChange} />
      )}
      {triggerType === 'tag_added' && (
        <TagAddedTriggerFields node={node} ctx={ctx} onChange={onChange} />
      )}
    </div>
  );
}

function TaskCompletedTriggerFields({
  node,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'trigger' }>;
  onChange: (n: GraphNode) => void;
}) {
  const kinds = Array.isArray(node.data.trigger_config.task_kind_in)
    ? (node.data.trigger_config.task_kind_in as string[])
    : [];
  function toggle(k: string) {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    onChange({
      ...node,
      data: {
        ...node.data,
        trigger_config: { ...node.data.trigger_config, task_kind_in: next },
      },
    });
  }
  return (
    <div>
      <Label>Task kind filter (optional)</Label>
      <p className="mb-1.5 text-[11px] text-txt-3">
        Leave empty to fire on any kind. Otherwise only completions of the selected kinds trigger
        the workflow.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(['call', 'text', 'email', 'meeting', 'note', 'other'] as const).map((k) => {
          const on = kinds.includes(k);
          return (
            <button
              type="button"
              key={k}
              onClick={() => toggle(k)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                on
                  ? 'border-teal/60 bg-teal/10 text-teal'
                  : 'border-line bg-canvas text-txt-2 hover:border-teal/30'
              }`}
            >
              {k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CallEndedTriggerFields({
  node,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'trigger' }>;
  onChange: (n: GraphNode) => void;
}) {
  const dirs = Array.isArray(node.data.trigger_config.direction_in)
    ? (node.data.trigger_config.direction_in as string[])
    : [];
  function toggle(d: string) {
    const next = dirs.includes(d) ? dirs.filter((x) => x !== d) : [...dirs, d];
    onChange({
      ...node,
      data: {
        ...node.data,
        trigger_config: { ...node.data.trigger_config, direction_in: next },
      },
    });
  }
  return (
    <div>
      <Label>Direction filter (optional)</Label>
      <p className="mb-1.5 text-[11px] text-txt-3">
        Leave empty to fire on any call. Duration is exposed as
        {' '}
        <code className="rounded bg-canvas px-1">{'{{trigger.durationSec}}'}</code>.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(['inbound', 'outbound'] as const).map((d) => {
          const on = dirs.includes(d);
          return (
            <button
              type="button"
              key={d}
              onClick={() => toggle(d)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                on
                  ? 'border-teal/60 bg-teal/10 text-teal'
                  : 'border-line bg-canvas text-txt-2 hover:border-teal/30'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TagAddedTriggerFields({
  node,
  ctx,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'trigger' }>;
  ctx: Props['ctx'];
  onChange: (n: GraphNode) => void;
}) {
  const tagIds = Array.isArray(node.data.trigger_config.tag_in)
    ? (node.data.trigger_config.tag_in as string[])
    : [];
  function toggle(id: string) {
    const next = tagIds.includes(id) ? tagIds.filter((x) => x !== id) : [...tagIds, id];
    onChange({
      ...node,
      data: {
        ...node.data,
        trigger_config: { ...node.data.trigger_config, tag_in: next },
      },
    });
  }
  return (
    <div>
      <Label>Tag filter (optional)</Label>
      <p className="mb-1.5 text-[11px] text-txt-3">
        Leave empty to fire on any tag. Tag name is exposed as
        {' '}
        <code className="rounded bg-canvas px-1">{'{{trigger.tagName}}'}</code>.
      </p>
      {ctx.tags.length === 0 ? (
        <p className="text-[12px] text-txt-3">No tags defined.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ctx.tags.map((t) => {
            const on = tagIds.includes(t.id);
            return (
              <button
                type="button"
                key={t.id}
                onClick={() => toggle(t.id)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                  on
                    ? 'border-teal/60 bg-teal/10 text-teal'
                    : 'border-line bg-canvas text-txt-2 hover:border-teal/30'
                }`}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LeadCreatedTriggerFields({
  node,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'trigger' }>;
  onChange: (n: GraphNode) => void;
}) {
  const sources = Array.isArray(node.data.trigger_config.source_in)
    ? (node.data.trigger_config.source_in as string[])
    : [];
  const [draft, setDraft] = useState('');
  function add() {
    const v = draft.trim();
    if (!v || sources.includes(v)) return;
    onChange({
      ...node,
      data: {
        ...node.data,
        trigger_config: { ...node.data.trigger_config, source_in: [...sources, v] },
      },
    });
    setDraft('');
  }
  function remove(s: string) {
    onChange({
      ...node,
      data: {
        ...node.data,
        trigger_config: {
          ...node.data.trigger_config,
          source_in: sources.filter((x) => x !== s),
        },
      },
    });
  }
  return (
    <div className="space-y-2">
      <Label>Source filter (optional)</Label>
      <p className="text-[11px] text-txt-3">
        Leave empty to fire for every new lead. Otherwise only leads whose <code className="rounded bg-canvas px-1">source</code> matches one of these values trigger the workflow.
      </p>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. fb_ads"
          className={`${inputCls} flex-1`}
        />
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-line bg-canvas px-2 py-1.5 text-[11.5px] hover:bg-surface-2"
        >
          Add
        </button>
      </div>
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <button
              type="button"
              key={s}
              onClick={() => remove(s)}
              className="rounded-full border border-teal/60 bg-teal/10 px-2.5 py-1 text-[11.5px] text-teal hover:bg-teal/20"
            >
              {s} ×
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StageChangedTriggerFields({
  node,
  ctx,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'trigger' }>;
  ctx: Props['ctx'];
  onChange: (n: GraphNode) => void;
}) {
  const toStages = Array.isArray(node.data.trigger_config.to_stage_in)
    ? (node.data.trigger_config.to_stage_in as string[])
    : [];
  const fromStages = Array.isArray(node.data.trigger_config.from_stage_in)
    ? (node.data.trigger_config.from_stage_in as string[])
    : [];
  function toggle(field: 'to_stage_in' | 'from_stage_in', current: string[], id: string) {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onChange({
      ...node,
      data: {
        ...node.data,
        trigger_config: { ...node.data.trigger_config, [field]: next },
      },
    });
  }
  return (
    <div className="space-y-3">
      <div>
        <Label>Moves to stage (optional)</Label>
        <p className="mb-1.5 text-[11px] text-txt-3">
          Leave empty to fire on any stage change.
        </p>
        {ctx.stages.length === 0 ? (
          <p className="text-[12px] text-txt-3">No stages defined.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ctx.stages.map((s) => {
              const on = toStages.includes(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => toggle('to_stage_in', toStages, s.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                    on
                      ? 'border-teal/60 bg-teal/10 text-teal'
                      : 'border-line bg-canvas text-txt-2 hover:border-teal/30'
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <Label>Moves from stage (optional)</Label>
        {ctx.stages.length === 0 ? (
          <p className="text-[12px] text-txt-3">No stages defined.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ctx.stages.map((s) => {
              const on = fromStages.includes(s.id);
              return (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => toggle('from_stage_in', fromStages, s.id)}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                    on
                      ? 'border-teal/60 bg-teal/10 text-teal'
                      : 'border-line bg-canvas text-txt-2 hover:border-teal/30'
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmailReceivedTriggerFields() {
  return (
    <div className="rounded-lg border border-line bg-canvas/50 p-3 text-[11.5px] text-txt-3">
      Fires when an inbound email arrives that matches a lead by email address. The matched lead is exposed as <code className="text-txt-1">{'{{lead.*}}'}</code>; the message subject is <code className="text-txt-1">{'{{trigger.subject}}'}</code> and sender is <code className="text-txt-1">{'{{trigger.fromAddr}}'}</code>.
    </div>
  );
}

function AppointmentBookedTriggerFields() {
  return (
    <div className="rounded-lg border border-line bg-canvas/50 p-3 text-[11.5px] text-txt-3">
      Fires when a new appointment is created for a lead. The matched lead is exposed as <code className="text-txt-1">{'{{lead.*}}'}</code>; appointment start time is <code className="text-txt-1">{'{{trigger.startsAt}}'}</code>.
    </div>
  );
}

function CallReceivedTriggerFields() {
  return (
    <div className="rounded-lg border border-line bg-canvas/50 p-3 text-[11.5px] text-txt-3">
      Fires for every inbound call to any of this brand&apos;s numbers. The matched
      lead (if any) is available as <code className="text-txt-1">{'{{lead.*}}'}</code>;
      caller / callee numbers are exposed as
      {' '}
      <code className="text-txt-1">{'{{trigger.fromNumber}}'}</code> and
      {' '}
      <code className="text-txt-1">{'{{trigger.toNumber}}'}</code>.
    </div>
  );
}

function DispositionTriggerFields({
  node,
  ctx,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'trigger' }>;
  ctx: Props['ctx'];
  onChange: (n: GraphNode) => void;
}) {
  const codes = Array.isArray(node.data.trigger_config.codes)
    ? (node.data.trigger_config.codes as string[])
    : [];
  function toggle(code: string) {
    const next = codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code];
    onChange({
      ...node,
      data: {
        ...node.data,
        trigger_config: { ...node.data.trigger_config, codes: next },
      },
    });
  }
  return (
    <div>
      <Label>When disposition is</Label>
      {ctx.dispositions.length === 0 ? (
        <p className="text-[12px] text-txt-3">No active dispositions. Add some in Settings.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ctx.dispositions.map((d) => {
            const on = codes.includes(d.code);
            return (
              <button
                type="button"
                key={d.code}
                onClick={() => toggle(d.code)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                  on
                    ? 'border-teal/60 bg-teal/10 text-teal'
                    : 'border-line bg-canvas text-txt-2 hover:border-teal/30'
                }`}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WebhookTriggerFields({ ctx }: { ctx: Props['ctx'] }) {
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState(ctx.automation?.webhookToken ?? null);
  const [copied, setCopied] = useState(false);

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://your-app.example';
  const url = token ? `${origin}/api/webhooks/automation/${token}` : null;

  async function regen() {
    if (!ctx.automation?.id) return;
    startTransition(async () => {
      const res = await regenerateWebhookToken({ id: ctx.automation!.id });
      if (res.ok) {
        // The action revalidated the page; until the parent rerenders we
        // optimistically clear the token and prompt a save.
        setToken(null);
        // Force a soft reload so loadAutomation picks up the new token.
        if (typeof window !== 'undefined') window.location.reload();
      }
    });
  }

  return (
    <div className="space-y-3">
      {!token ? (
        <p className="text-[12px] text-txt-3">
          Save the workflow once to generate a public webhook URL. Trigger config is empty for
          this kind — the URL itself is the trigger.
        </p>
      ) : (
        <>
          <Label>Webhook URL</Label>
          <div className="flex items-center gap-1">
            <input
              type="text"
              readOnly
              value={url ?? ''}
              className={`${inputCls} flex-1 font-mono text-[11px]`}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              onClick={async () => {
                if (!url) return;
                try {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1200);
                } catch {
                  /* ignore */
                }
              }}
              className="rounded-md border border-line bg-canvas px-2 py-1.5 text-[11.5px] hover:bg-surface-2"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[11px] text-txt-3">
            POST any JSON body. Pass <code className="rounded bg-canvas px-1">lead_id</code> to
            scope the run to a specific lead. Reference the body in templates with{' '}
            <code className="rounded bg-canvas px-1">{'{{webhook.body.field}}'}</code>.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={regen}
            className="rounded-md border border-hp/30 bg-hp/5 px-2.5 py-1 text-[11.5px] text-hp hover:bg-hp/10 disabled:opacity-50"
          >
            {pending ? 'Regenerating…' : 'Regenerate token'}
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

function ActionEditor({
  node,
  ctx,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'action' }>;
  ctx: Props['ctx'];
  onChange: (n: GraphNode) => void;
}) {
  const action = node.data.action;
  function patch(p: Partial<AutomationAction>) {
    onChange({
      ...node,
      data: { action: { ...action, ...p } as AutomationAction },
    });
  }
  function changeKind(kind: AutomationAction['kind']) {
    let next: AutomationAction;
    switch (kind) {
      case 'move_stage':
        next = { kind: 'move_stage', stage_id: ctx.stages[0]?.id ?? '' };
        break;
      case 'mark_dnc':
        next = { kind: 'mark_dnc' };
        break;
      case 'add_tag':
        next = { kind: 'add_tag', tag_id: ctx.tags[0]?.id ?? '' };
        break;
      case 'create_task':
        next = { kind: 'create_task', title: 'Follow up', task_kind: 'call', assign_to_caller: true };
        break;
      case 'send_email':
        next = { kind: 'send_email', to: 'lead', subject: 'Following up', body: 'Hi {{lead.first_name}},\n\n' };
        break;
      case 'send_sms':
        next = { kind: 'send_sms', to: 'lead', body: 'Hi {{lead.first_name}}, ' };
        break;
      case 'send_notification':
        next = { kind: 'send_notification', recipient_kind: 'caller', title: 'Workflow update' };
        break;
      case 'http_request':
        next = { kind: 'http_request', method: 'POST', url: '', headers: [], body_template: '{}' };
        break;
      case 'update_lead_field':
        next = { kind: 'update_lead_field', field: 'first_name', value: '' };
        break;
      case 'create_contact':
        next = {
          kind: 'create_contact',
          first_name: '{{webhook.body.first_name}}',
          last_name: '{{webhook.body.last_name}}',
          email: '{{webhook.body.email}}',
          phone: '{{webhook.body.phone}}',
          set_as_run_lead: true,
        };
        break;
    }
    onChange({ ...node, data: { action: next } });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Action type</Label>
        <select
          value={action.kind}
          onChange={(e) => changeKind(e.target.value as AutomationAction['kind'])}
          className={inputCls}
        >
          <optgroup label="Communication">
            <option value="send_email">Send email</option>
            <option value="send_sms">Send SMS</option>
            <option value="send_notification">Notify team (in-app)</option>
          </optgroup>
          <optgroup label="Lead actions">
            <option value="move_stage">Move lead to stage</option>
            <option value="add_tag">Add tag</option>
            <option value="mark_dnc">Mark Do Not Call</option>
            <option value="create_task">Create task</option>
            <option value="update_lead_field">Update lead field</option>
            <option value="create_contact">Create contact</option>
          </optgroup>
          <optgroup label="Integration">
            <option value="http_request">HTTP request</option>
          </optgroup>
        </select>
      </div>

      {action.kind === 'move_stage' && (
        <div>
          <Label>Target stage</Label>
          <select
            value={action.stage_id}
            onChange={(e) => patch({ stage_id: e.target.value } as Partial<AutomationAction>)}
            className={inputCls}
          >
            {ctx.stages.length === 0 ? (
              <option value="">No stages</option>
            ) : (
              ctx.stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      {action.kind === 'add_tag' && (
        <div>
          <Label>Tag</Label>
          <select
            value={action.tag_id}
            onChange={(e) => patch({ tag_id: e.target.value } as Partial<AutomationAction>)}
            className={inputCls}
          >
            {ctx.tags.length === 0 ? (
              <option value="">No tags</option>
            ) : (
              ctx.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))
            )}
          </select>
        </div>
      )}

      {action.kind === 'mark_dnc' && (
        <p className="text-[11.5px] text-txt-3">
          Sets <code className="rounded bg-canvas px-1">do_not_call = true</code> on the lead.
        </p>
      )}

      {action.kind === 'create_task' && (
        <div className="space-y-3">
          <div>
            <Label>Task title</Label>
            <input
              type="text"
              value={action.title}
              onChange={(e) => patch({ title: e.target.value } as Partial<AutomationAction>)}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Kind</Label>
              <select
                value={action.task_kind ?? 'other'}
                onChange={(e) =>
                  patch({ task_kind: e.target.value as 'call' | 'text' | 'email' | 'meeting' | 'note' | 'other' } as Partial<AutomationAction>)
                }
                className={inputCls}
              >
                <option value="call">Call</option>
                <option value="text">Text</option>
                <option value="email">Email</option>
                <option value="meeting">Meeting</option>
                <option value="note">Note</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <Label>Due</Label>
              <select
                value={action.use_callback_at ? 'callback' : action.due_in_minutes ? 'in' : 'none'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'callback') {
                    patch({ use_callback_at: true, due_in_minutes: undefined } as Partial<AutomationAction>);
                  } else if (v === 'in') {
                    patch({
                      use_callback_at: false,
                      due_in_minutes: action.due_in_minutes ?? 60,
                    } as Partial<AutomationAction>);
                  } else {
                    patch({ use_callback_at: false, due_in_minutes: undefined } as Partial<AutomationAction>);
                  }
                }}
                className={inputCls}
              >
                <option value="none">No due date</option>
                <option value="callback">At callback time</option>
                <option value="in">In N minutes</option>
              </select>
            </div>
          </div>
          {!action.use_callback_at && typeof action.due_in_minutes === 'number' && (
            <div>
              <Label>Minutes from now</Label>
              <input
                type="number"
                min={1}
                value={action.due_in_minutes}
                onChange={(e) => patch({ due_in_minutes: Number(e.target.value) || 0 } as Partial<AutomationAction>)}
                className={inputCls}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-[11.5px] text-txt-2">
            <input
              type="checkbox"
              checked={action.assign_to_caller ?? false}
              onChange={(e) => patch({ assign_to_caller: e.target.checked } as Partial<AutomationAction>)}
            />
            Assign to the agent who took the call
          </label>
        </div>
      )}

      {action.kind === 'send_email' && (
        <SendEmailEditor action={action} patch={patch} />
      )}
      {action.kind === 'send_sms' && (
        <SendSmsEditor action={action} patch={patch} />
      )}
      {action.kind === 'send_notification' && (
        <SendNotificationEditor action={action} ctx={ctx} patch={patch} />
      )}
      {action.kind === 'http_request' && (
        <HttpRequestEditor action={action} patch={patch} />
      )}
      {action.kind === 'update_lead_field' && (
        <UpdateLeadFieldEditor action={action} patch={patch} />
      )}
      {action.kind === 'create_contact' && (
        <CreateContactEditor action={action} ctx={ctx} patch={patch} />
      )}

      <TokensHint />
    </div>
  );
}

function SendEmailEditor({
  action,
  patch,
}: {
  action: Extract<AutomationAction, { kind: 'send_email' }>;
  patch: (p: Partial<AutomationAction>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Recipient</Label>
        <select
          value={action.to}
          onChange={(e) => patch({ to: e.target.value as 'lead' | 'literal' } as Partial<AutomationAction>)}
          className={inputCls}
        >
          <option value="lead">Lead's email</option>
          <option value="literal">Specific address</option>
        </select>
      </div>
      {action.to === 'literal' && (
        <div>
          <Label>To</Label>
          <input
            type="text"
            value={action.literal_to ?? ''}
            onChange={(e) => patch({ literal_to: e.target.value } as Partial<AutomationAction>)}
            placeholder="ops@example.com"
            className={inputCls}
          />
        </div>
      )}
      <div>
        <Label>Subject</Label>
        <input
          type="text"
          value={action.subject}
          onChange={(e) => patch({ subject: e.target.value } as Partial<AutomationAction>)}
          className={inputCls}
        />
      </div>
      <div>
        <Label>Body</Label>
        <textarea
          rows={6}
          value={action.body}
          onChange={(e) => patch({ body: e.target.value } as Partial<AutomationAction>)}
          className={`${inputCls} resize-y font-mono text-[12px]`}
        />
      </div>
      <p className="text-[11px] text-txt-3">
        Queued in the message outbox. Hooks up to your email provider when{' '}
        <code className="rounded bg-canvas px-1">RESEND_API_KEY</code> is configured.
      </p>
    </div>
  );
}

function SendSmsEditor({
  action,
  patch,
}: {
  action: Extract<AutomationAction, { kind: 'send_sms' }>;
  patch: (p: Partial<AutomationAction>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Recipient</Label>
        <select
          value={action.to}
          onChange={(e) => patch({ to: e.target.value as 'lead' | 'literal' } as Partial<AutomationAction>)}
          className={inputCls}
        >
          <option value="lead">Lead's phone</option>
          <option value="literal">Specific number</option>
        </select>
      </div>
      {action.to === 'literal' && (
        <div>
          <Label>To (E.164)</Label>
          <input
            type="text"
            value={action.literal_to ?? ''}
            onChange={(e) => patch({ literal_to: e.target.value } as Partial<AutomationAction>)}
            placeholder="+15555550123"
            className={inputCls}
          />
        </div>
      )}
      <div>
        <Label>Message</Label>
        <textarea
          rows={4}
          value={action.body}
          onChange={(e) => patch({ body: e.target.value } as Partial<AutomationAction>)}
          className={`${inputCls} resize-y`}
        />
      </div>
    </div>
  );
}

function SendNotificationEditor({
  action,
  ctx,
  patch,
}: {
  action: Extract<AutomationAction, { kind: 'send_notification' }>;
  ctx: Props['ctx'];
  patch: (p: Partial<AutomationAction>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label>Recipient</Label>
        <select
          value={action.recipient_kind}
          onChange={(e) =>
            patch({
              recipient_kind: e.target.value as Extract<AutomationAction, { kind: 'send_notification' }>['recipient_kind'],
            } as Partial<AutomationAction>)
          }
          className={inputCls}
        >
          <option value="caller">The agent who took the call</option>
          <option value="lead_owner">Lead's owner</option>
          <option value="role">Everyone with a role</option>
          <option value="member">A specific member</option>
        </select>
      </div>
      {action.recipient_kind === 'role' && (
        <div>
          <Label>Role</Label>
          <select
            value={action.role ?? 'manager'}
            onChange={(e) => patch({ role: e.target.value as MemberRole } as Partial<AutomationAction>)}
            className={inputCls}
          >
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="agent">Agent</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
      )}
      {action.recipient_kind === 'member' && ctx.members && ctx.members.length > 0 && (
        <div>
          <Label>Member</Label>
          <select
            value={action.member_id ?? ''}
            onChange={(e) => patch({ member_id: e.target.value } as Partial<AutomationAction>)}
            className={inputCls}
          >
            <option value="">Pick someone</option>
            {ctx.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name || m.email}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <Label>Title</Label>
        <input
          type="text"
          value={action.title}
          onChange={(e) => patch({ title: e.target.value } as Partial<AutomationAction>)}
          className={inputCls}
        />
      </div>
      <div>
        <Label>Body (optional)</Label>
        <textarea
          rows={3}
          value={action.body ?? ''}
          onChange={(e) => patch({ body: e.target.value } as Partial<AutomationAction>)}
          className={`${inputCls} resize-y`}
        />
      </div>
      <div>
        <Label>Link URL (optional)</Label>
        <input
          type="text"
          value={action.link_url ?? ''}
          onChange={(e) => patch({ link_url: e.target.value } as Partial<AutomationAction>)}
          placeholder="/leads/{{webhook.body.lead_id}}"
          className={inputCls}
        />
      </div>
    </div>
  );
}

function HttpRequestEditor({
  action,
  patch,
}: {
  action: Extract<AutomationAction, { kind: 'http_request' }>;
  patch: (p: Partial<AutomationAction>) => void;
}) {
  const headers = action.headers ?? [];
  function setHeader(i: number, key: 'key' | 'value', v: string) {
    const next = headers.slice();
    next[i] = { ...next[i], [key]: v } as { key: string; value: string };
    patch({ headers: next } as Partial<AutomationAction>);
  }
  function addHeader() {
    patch({ headers: [...headers, { key: '', value: '' }] } as Partial<AutomationAction>);
  }
  function removeHeader(i: number) {
    const next = headers.slice();
    next.splice(i, 1);
    patch({ headers: next } as Partial<AutomationAction>);
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[90px_1fr] gap-2">
        <div>
          <Label>Method</Label>
          <select
            value={action.method}
            onChange={(e) => patch({ method: e.target.value as HttpMethod } as Partial<AutomationAction>)}
            className={inputCls}
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
          </select>
        </div>
        <div>
          <Label>URL</Label>
          <input
            type="text"
            value={action.url}
            onChange={(e) => patch({ url: e.target.value } as Partial<AutomationAction>)}
            placeholder="https://hooks.example.com/abc"
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <Label>Headers</Label>
          <button
            type="button"
            onClick={addHeader}
            className="text-[11.5px] text-teal hover:underline"
          >
            + Add header
          </button>
        </div>
        <div className="space-y-1.5">
          {headers.map((h, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
              <input
                type="text"
                value={h.key}
                onChange={(e) => setHeader(i, 'key', e.target.value)}
                placeholder="Authorization"
                className={inputCls}
              />
              <input
                type="text"
                value={h.value}
                onChange={(e) => setHeader(i, 'value', e.target.value)}
                placeholder="Bearer …"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => removeHeader(i)}
                className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-hp/10 hover:text-hp"
                aria-label="Remove header"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
      {action.method !== 'GET' && (
        <div>
          <Label>Body (template)</Label>
          <textarea
            rows={5}
            value={action.body_template ?? ''}
            onChange={(e) => patch({ body_template: e.target.value } as Partial<AutomationAction>)}
            placeholder='{ "lead_id": "{{lead.email}}" }'
            className={`${inputCls} resize-y font-mono text-[11.5px]`}
          />
        </div>
      )}
      <p className="text-[11px] text-txt-3">
        Private IPs (10/8, 172.16/12, 192.168/16, 127/8) are blocked. 5s timeout, retry once on
        5xx.
      </p>
    </div>
  );
}

function UpdateLeadFieldEditor({
  action,
  patch,
}: {
  action: Extract<AutomationAction, { kind: 'update_lead_field' }>;
  patch: (p: Partial<AutomationAction>) => void;
}) {
  const isCustom = action.field.startsWith('custom.');
  const customKey = isCustom ? action.field.slice('custom.'.length) : '';

  return (
    <div className="space-y-3">
      <div>
        <Label>Field</Label>
        <select
          value={isCustom ? '__custom' : action.field}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '__custom') {
              patch({ field: 'custom.' as LeadFieldKey } as Partial<AutomationAction>);
            } else {
              patch({ field: v as LeadFieldKey } as Partial<AutomationAction>);
            }
          }}
          className={inputCls}
        >
          <option value="first_name">first_name</option>
          <option value="last_name">last_name</option>
          <option value="email">email</option>
          <option value="phone">phone</option>
          <option value="notes">notes</option>
          <option value="__custom">Custom field…</option>
        </select>
      </div>
      {isCustom && (
        <div>
          <Label>Custom field key</Label>
          <input
            type="text"
            value={customKey}
            onChange={(e) =>
              patch({ field: `custom.${e.target.value}` as LeadFieldKey } as Partial<AutomationAction>)
            }
            placeholder="lead_score"
            className={inputCls}
          />
        </div>
      )}
      <div>
        <Label>Value</Label>
        <input
          type="text"
          value={action.value}
          onChange={(e) => patch({ value: e.target.value } as Partial<AutomationAction>)}
          placeholder="{{lead.first_name}} (Sale)"
          className={inputCls}
        />
      </div>
    </div>
  );
}

function CreateContactEditor({
  action,
  ctx,
  patch,
}: {
  action: Extract<AutomationAction, { kind: 'create_contact' }>;
  ctx: Props['ctx'];
  patch: (p: Partial<AutomationAction>) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11.5px] text-txt-3">
        Inserts a new lead. Every field accepts templates — paired with a webhook trigger,
        defaults pull from the body's <code className="rounded bg-canvas px-1">first_name</code>,
        <code className="rounded bg-canvas px-1">last_name</code>,{' '}
        <code className="rounded bg-canvas px-1">email</code>,{' '}
        <code className="rounded bg-canvas px-1">phone</code>.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>First name</Label>
          <input
            type="text"
            value={action.first_name ?? ''}
            onChange={(e) => patch({ first_name: e.target.value } as Partial<AutomationAction>)}
            className={inputCls}
          />
        </div>
        <div>
          <Label>Last name</Label>
          <input
            type="text"
            value={action.last_name ?? ''}
            onChange={(e) => patch({ last_name: e.target.value } as Partial<AutomationAction>)}
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <Label>Email</Label>
        <input
          type="text"
          value={action.email ?? ''}
          onChange={(e) => patch({ email: e.target.value } as Partial<AutomationAction>)}
          className={inputCls}
        />
      </div>
      <div>
        <Label>Phone</Label>
        <input
          type="text"
          value={action.phone ?? ''}
          onChange={(e) => patch({ phone: e.target.value } as Partial<AutomationAction>)}
          placeholder="+15555550123"
          className={inputCls}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>City</Label>
          <input
            type="text"
            value={action.city ?? ''}
            onChange={(e) => patch({ city: e.target.value } as Partial<AutomationAction>)}
            className={inputCls}
          />
        </div>
        <div>
          <Label>State</Label>
          <input
            type="text"
            value={action.state ?? ''}
            onChange={(e) => patch({ state: e.target.value } as Partial<AutomationAction>)}
            className={inputCls}
          />
        </div>
        <div>
          <Label>Zip</Label>
          <input
            type="text"
            value={action.zip ?? ''}
            onChange={(e) => patch({ zip: e.target.value } as Partial<AutomationAction>)}
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <Label>Notes</Label>
        <textarea
          rows={2}
          value={action.notes ?? ''}
          onChange={(e) => patch({ notes: e.target.value } as Partial<AutomationAction>)}
          className={`${inputCls} resize-y`}
        />
      </div>
      <div>
        <Label>Initial stage (optional)</Label>
        <select
          value={action.stage_id ?? ''}
          onChange={(e) => patch({ stage_id: e.target.value || undefined } as Partial<AutomationAction>)}
          className={inputCls}
        >
          <option value="">None</option>
          {ctx.stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-start gap-2 text-[11.5px] text-txt-2">
        <input
          type="checkbox"
          checked={action.set_as_run_lead ?? true}
          onChange={(e) => patch({ set_as_run_lead: e.target.checked } as Partial<AutomationAction>)}
          className="mt-0.5"
        />
        <span>
          Use this contact for the rest of the run — downstream actions like Send email or Move
          stage will target it.
        </span>
      </label>
      <p className="text-[11px] text-txt-3">
        At least one of name, email, or phone must resolve to a non-empty value or the row is
        skipped.
      </p>
    </div>
  );
}

function TokensHint() {
  return (
    <details className="rounded-lg border border-line bg-canvas/50 p-2 text-[11px] text-txt-3">
      <summary className="cursor-pointer text-txt-2">Available tokens</summary>
      <div className="mt-1.5 space-y-0.5 font-mono">
        <div>{'{{lead.first_name}} {{lead.last_name}} {{lead.full_name}}'}</div>
        <div>{'{{lead.email}} {{lead.phone}} {{lead.stage}}'}</div>
        <div>{'{{brand.name}}'}</div>
        <div>{'{{trigger.disposition}} {{trigger.callback_at}}'}</div>
        <div>{'{{webhook.body.<json-path>}}'}</div>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Branch
// ---------------------------------------------------------------------------

function BranchEditor({
  node,
  ctx,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'branch' }>;
  ctx: Props['ctx'];
  onChange: (n: GraphNode) => void;
}) {
  const cond = node.data.condition;

  function setKind(kind: BranchCondition['kind']) {
    let next: BranchCondition;
    switch (kind) {
      case 'disposition_equals':
        next = { kind: 'disposition_equals', codes: [] };
        break;
      case 'lead_in_stage':
        next = { kind: 'lead_in_stage', stage_id: ctx.stages[0]?.id ?? '' };
        break;
      case 'lead_has_tag':
        next = { kind: 'lead_has_tag', tag_id: ctx.tags[0]?.id ?? '' };
        break;
      case 'lead_field_equals':
        next = { kind: 'lead_field_equals', field: 'do_not_call', value: true };
        break;
    }
    onChange({ ...node, data: { condition: next } });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Condition type</Label>
        <select
          value={cond.kind}
          onChange={(e) => setKind(e.target.value as BranchCondition['kind'])}
          className={inputCls}
        >
          <option value="disposition_equals">Disposition matches</option>
          <option value="lead_in_stage">Lead is in stage</option>
          <option value="lead_has_tag">Lead has tag</option>
          <option value="lead_field_equals">Lead is Do Not Call</option>
        </select>
      </div>

      {cond.kind === 'disposition_equals' && (
        <div>
          <Label>Match disposition codes</Label>
          <div className="flex flex-wrap gap-1.5">
            {ctx.dispositions.map((d) => {
              const on = cond.codes.includes(d.code);
              return (
                <button
                  type="button"
                  key={d.code}
                  onClick={() => {
                    const next = on ? cond.codes.filter((c) => c !== d.code) : [...cond.codes, d.code];
                    onChange({ ...node, data: { condition: { ...cond, codes: next } } });
                  }}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                    on
                      ? 'border-teal/60 bg-teal/10 text-teal'
                      : 'border-line bg-canvas text-txt-2 hover:border-teal/30'
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {cond.kind === 'lead_in_stage' && (
        <div>
          <Label>Stage</Label>
          <select
            value={cond.stage_id}
            onChange={(e) =>
              onChange({ ...node, data: { condition: { ...cond, stage_id: e.target.value } } })
            }
            className={inputCls}
          >
            {ctx.stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {cond.kind === 'lead_has_tag' && (
        <div>
          <Label>Tag</Label>
          <select
            value={cond.tag_id}
            onChange={(e) =>
              onChange({ ...node, data: { condition: { ...cond, tag_id: e.target.value } } })
            }
            className={inputCls}
          >
            {ctx.tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {cond.kind === 'lead_field_equals' && (
        <div>
          <Label>Match value</Label>
          <select
            value={String(cond.value)}
            onChange={(e) =>
              onChange({
                ...node,
                data: { condition: { ...cond, value: e.target.value === 'true' } },
              })
            }
            className={inputCls}
          >
            <option value="true">Yes — lead is DNC</option>
            <option value="false">No — lead is not DNC</option>
          </select>
        </div>
      )}

      <p className="text-[11px] text-txt-3">
        Yes path runs when the condition matches. No path runs when it doesn't. Connect both
        outputs from the canvas.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wait
// ---------------------------------------------------------------------------

function WaitEditor({
  node,
  onChange,
}: {
  node: Extract<GraphNode, { type: 'wait' }>;
  onChange: (n: GraphNode) => void;
}) {
  const data = node.data as WaitNodeData;
  const mode: WaitMode = (data as { mode?: WaitMode }).mode ?? 'fixed_minutes';
  function setMode(next: WaitMode) {
    let nextData: WaitNodeData;
    switch (next) {
      case 'fixed_minutes':
        nextData = { mode: 'fixed_minutes', duration_minutes: 5 };
        break;
      case 'until_callback_time':
        nextData = { mode: 'until_callback_time' };
        break;
      case 'until_datetime':
        nextData = { mode: 'until_datetime', iso_at: '' };
        break;
      case 'business_days':
        nextData = { mode: 'business_days', days: 1 };
        break;
    }
    onChange({ ...node, data: nextData });
  }
  return (
    <div className="space-y-3">
      <div>
        <Label>Wait until</Label>
        <select value={mode} onChange={(e) => setMode(e.target.value as WaitMode)} className={inputCls}>
          <option value="fixed_minutes">A fixed amount of time</option>
          <option value="until_callback_time">The lead's callback time</option>
          <option value="until_datetime">A specific date &amp; time</option>
          <option value="business_days">N business days from now</option>
        </select>
      </div>

      {mode === 'fixed_minutes' && (
        <div>
          <Label>Minutes</Label>
          <input
            type="number"
            min={0}
            value={(data as { duration_minutes: number }).duration_minutes}
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  mode: 'fixed_minutes',
                  duration_minutes: Math.max(0, Number(e.target.value) || 0),
                },
              })
            }
            className={inputCls}
          />
        </div>
      )}

      {mode === 'until_callback_time' && (
        <p className="text-[11.5px] text-txt-3">
          Pauses until the call's <code className="rounded bg-canvas px-1">callback_at</code>{' '}
          timestamp. If the call had no callback set, this falls through with no delay.
        </p>
      )}

      {mode === 'until_datetime' && (
        <div>
          <Label>Resume at (local time)</Label>
          <input
            type="datetime-local"
            value={toLocalInput((data as { iso_at: string }).iso_at)}
            onChange={(e) =>
              onChange({
                ...node,
                data: {
                  mode: 'until_datetime',
                  iso_at: e.target.value ? new Date(e.target.value).toISOString() : '',
                },
              })
            }
            className={inputCls}
          />
        </div>
      )}

      {mode === 'business_days' && (
        <div>
          <Label>Days (Mon–Fri)</Label>
          <input
            type="number"
            min={0}
            value={(data as { days: number }).days}
            onChange={(e) =>
              onChange({
                ...node,
                data: { mode: 'business_days', days: Math.max(0, Number(e.target.value) || 0) },
              })
            }
            className={inputCls}
          />
        </div>
      )}

      <p className="text-[11px] text-txt-3">
        Resumed by a 1-minute cron tick — actual execution may happen up to a minute after the
        configured time.
      </p>
    </div>
  );
}

function toLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20';

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-[11.5px] font-medium text-txt-2">{children}</span>;
}
