'use client';

// Right-side panel that edits the currently selected node. Renders a
// per-type form that mutates the underlying GraphNode via onChange. The
// canvas itself owns the node state — this panel is dumb.

import type {
  AutomationAction,
  BranchCondition,
  GraphNode,
} from '@/lib/automation-types';

type Props = {
  node: GraphNode;
  ctx: {
    stages: { id: string; name: string }[];
    tags: { id: string; name: string }[];
    dispositions: { code: string; label: string }[];
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
  if (node.data.trigger_type !== 'disposition_set') {
    return <p className="text-[12px] text-txt-3">Trigger: {node.data.trigger_type}</p>;
  }
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
          <option value="move_stage">Move lead to stage</option>
          <option value="mark_dnc">Mark Do Not Call</option>
          <option value="add_tag">Add tag</option>
          <option value="create_task">Create task</option>
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
    </div>
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
  return (
    <div>
      <Label>Wait duration (minutes)</Label>
      <input
        type="number"
        min={0}
        value={node.data.duration_minutes}
        onChange={(e) =>
          onChange({
            ...node,
            data: { duration_minutes: Math.max(0, Number(e.target.value) || 0) },
          })
        }
        className={inputCls}
      />
      <p className="mt-2 text-[11px] text-txt-3">
        Resumed by a 1-minute cron tick — actual execution may happen up to a minute after the
        configured duration.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20';

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-[11.5px] font-medium text-txt-2">{children}</span>;
}
