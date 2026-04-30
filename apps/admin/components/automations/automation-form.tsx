'use client';

// Modal-style editor for a single automation. v1 only supports the
// `disposition_set` trigger and four action kinds; the form structure is
// designed to grow into more triggers without a rewrite (TriggerSection
// switches on triggerType and renders a config slot). Action cards are
// reorderable via drag handle (grip on the left of each card).

import { useId, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AutomationAction, Automation } from '@/lib/automation-types';
import type { StageRef, TagRef, DispositionRef } from './automations-manager';

type Props = {
  mode: 'create' | 'edit';
  initial: Automation | null;
  stages: StageRef[];
  tags: TagRef[];
  dispositions: DispositionRef[];
  /** When true, renders inline (no modal overlay or title bar). The host page is expected
   * to provide its own header. Defaults to modal. */
  inline?: boolean;
  onCancel: () => void;
  onSave: (values: {
    name: string;
    description: string;
    triggerType: string;
    triggerConfig: Record<string, unknown>;
    actions: AutomationAction[];
  }) => Promise<string | null>;
};

const ACTION_KINDS: { kind: AutomationAction['kind']; label: string }[] = [
  { kind: 'move_stage', label: 'Move lead to stage' },
  { kind: 'mark_dnc', label: 'Mark Do Not Call' },
  { kind: 'add_tag', label: 'Add tag to lead' },
  { kind: 'create_task', label: 'Create task' },
];

// Lightweight client-only id generator. Used to give each action card a
// stable identity for the dnd-kit SortableContext without polluting the
// persisted action shape.
function useIdGenerator() {
  const counter = useRef(0);
  const prefix = useId();
  return () => `${prefix}-${counter.current++}`;
}

export function AutomationForm({
  mode,
  initial,
  stages,
  tags,
  dispositions,
  inline = false,
  onCancel,
  onSave,
}: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [codes, setCodes] = useState<string[]>(() => {
    const c = initial?.triggerConfig?.codes;
    return Array.isArray(c) ? (c as string[]) : [];
  });
  const nextId = useIdGenerator();
  const [actions, setActions] = useState<{ id: string; data: AutomationAction }[]>(() =>
    (initial?.actions ?? []).map((a) => ({ id: nextId(), data: a })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function toggleCode(code: string) {
    setCodes((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  function addAction(kind: AutomationAction['kind']) {
    let next: AutomationAction;
    switch (kind) {
      case 'move_stage':
        next = { kind: 'move_stage', stage_id: stages[0]?.id ?? '' };
        break;
      case 'mark_dnc':
        next = { kind: 'mark_dnc' };
        break;
      case 'add_tag':
        next = { kind: 'add_tag', tag_id: tags[0]?.id ?? '' };
        break;
      case 'create_task':
        next = { kind: 'create_task', title: 'Follow up', task_kind: 'call', assign_to_caller: true };
        break;
    }
    setActions((prev) => [...prev, { id: nextId(), data: next }]);
  }

  function patchAction(id: string, patch: Partial<AutomationAction>) {
    setActions((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, data: { ...row.data, ...patch } as AutomationAction } : row,
      ),
    );
  }

  function removeAction(id: string) {
    setActions((prev) => prev.filter((row) => row.id !== id));
  }

  function onActionDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setActions((prev) => {
      const from = prev.findIndex((r) => r.id === active.id);
      const to = prev.findIndex((r) => r.id === over.id);
      if (from < 0 || to < 0) return prev;
      return arrayMove(prev, from, to);
    });
  }

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (codes.length === 0) {
      setError('Pick at least one disposition for the trigger.');
      return;
    }
    if (actions.length === 0) {
      setError('Add at least one action.');
      return;
    }
    for (const { data: a } of actions) {
      if (a.kind === 'move_stage' && !a.stage_id) {
        setError('Pick a stage for every "Move lead to stage" action.');
        return;
      }
      if (a.kind === 'add_tag' && !a.tag_id) {
        setError('Pick a tag for every "Add tag" action.');
        return;
      }
      if (a.kind === 'create_task' && !a.title.trim()) {
        setError('Task title is required.');
        return;
      }
    }

    setSaving(true);
    const err = await onSave({
      name: name.trim(),
      description: description.trim(),
      triggerType: 'disposition_set',
      triggerConfig: { codes },
      actions: actions.map((row) => row.data),
    });
    setSaving(false);
    if (err) setError(err);
  }

  const body = (
    <div
      className={
        inline
          ? 'rounded-2xl border border-line bg-surface'
          : 'w-full max-w-2xl rounded-2xl border border-line bg-surface shadow-xl'
      }
    >
      {!inline && (
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[14px] font-semibold">
            {mode === 'create' ? 'New automation' : 'Edit automation'}
          </h2>
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
      )}

      <div className={`space-y-5 px-5 py-4 ${inline ? '' : 'max-h-[70vh] overflow-y-auto'}`}>
          {error && (
            <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
              {error}
            </div>
          )}

          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sale → Won"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            />
          </Field>

          <Field label="Description (optional)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this automation does and why."
              className="w-full resize-none rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            />
          </Field>

          <div>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-txt-3">
              Trigger
            </h3>
            <div className="rounded-xl border border-line bg-canvas p-3">
              <p className="mb-3 text-[12px] text-txt-2">
                When a call disposition is set to any of the selected codes:
              </p>
              {dispositions.length === 0 ? (
                <p className="text-[12px] text-txt-3">
                  No active dispositions. Add some in Settings first.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {dispositions.map((d) => {
                    const on = codes.includes(d.code);
                    return (
                      <button
                        type="button"
                        key={d.code}
                        onClick={() => toggleCode(d.code)}
                        className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                          on
                            ? 'border-teal/60 bg-teal/10 text-teal'
                            : 'border-line bg-surface text-txt-2 hover:border-teal/30'
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-txt-3">
                Actions
              </h3>
              <div className="flex flex-wrap gap-1">
                {ACTION_KINDS.map((a) => (
                  <button
                    key={a.kind}
                    type="button"
                    onClick={() => addAction(a.kind)}
                    className="rounded-md border border-line bg-canvas px-2 py-1 text-[11px] hover:bg-surface-2"
                  >
                    + {a.label}
                  </button>
                ))}
              </div>
            </div>

            {actions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-txt-3">
                Add at least one action.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onActionDragEnd}
              >
                <SortableContext
                  items={actions.map((row) => row.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {actions.map((row, i) => (
                      <SortableActionEditor
                        key={row.id}
                        sortableId={row.id}
                        action={row.data}
                        index={i}
                        stages={stages}
                        tags={tags}
                        onPatch={(patch) => patchAction(row.id, patch)}
                        onRemove={() => removeAction(row.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
          </button>
        </div>
      </div>
  );

  if (inline) return body;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">{body}</div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-medium text-txt-2">{label}</span>
      {children}
    </label>
  );
}

function SortableActionEditor({
  sortableId,
  action,
  index,
  stages,
  tags,
  onPatch,
  onRemove,
}: {
  sortableId: string;
  action: AutomationAction;
  index: number;
  stages: StageRef[];
  tags: TagRef[];
  onPatch: (patch: Partial<AutomationAction>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border bg-canvas p-3 ${
        isDragging ? 'border-teal/50 shadow-lg' : 'border-line'
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Drag action"
            {...attributes}
            {...listeners}
            className="grid h-6 w-6 cursor-grab touch-none place-items-center rounded text-txt-3 hover:bg-surface-2 hover:text-txt-1 active:cursor-grabbing"
          >
            <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor">
              <circle cx="3" cy="2" r="1.2" />
              <circle cx="9" cy="2" r="1.2" />
              <circle cx="3" cy="7" r="1.2" />
              <circle cx="9" cy="7" r="1.2" />
              <circle cx="3" cy="12" r="1.2" />
              <circle cx="9" cy="12" r="1.2" />
            </svg>
          </button>
          <span className="grid h-5 w-5 place-items-center rounded-full bg-teal/10 text-[10px] font-semibold text-teal">
            {index + 1}
          </span>
          <span className="text-[12px] font-medium">{labelFor(action.kind)}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove action"
          className="grid h-6 w-6 place-items-center rounded text-txt-3 hover:bg-hp/10 hover:text-hp"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {action.kind === 'move_stage' && (
        <select
          value={action.stage_id}
          onChange={(e) => onPatch({ stage_id: e.target.value } as Partial<AutomationAction>)}
          className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        >
          {stages.length === 0 ? (
            <option value="">No stages — create one in Settings</option>
          ) : (
            stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))
          )}
        </select>
      )}

      {action.kind === 'mark_dnc' && (
        <p className="text-[11.5px] text-txt-3">
          Sets <code className="rounded bg-surface-2 px-1">do_not_call = true</code> on the lead.
        </p>
      )}

      {action.kind === 'add_tag' && (
        <select
          value={action.tag_id}
          onChange={(e) => onPatch({ tag_id: e.target.value } as Partial<AutomationAction>)}
          className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        >
          {tags.length === 0 ? (
            <option value="">No tags — create one in Settings</option>
          ) : (
            tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))
          )}
        </select>
      )}

      {action.kind === 'create_task' && (
        <div className="space-y-2">
          <input
            type="text"
            value={action.title}
            onChange={(e) => onPatch({ title: e.target.value } as Partial<AutomationAction>)}
            placeholder="Task title"
            className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={action.task_kind ?? 'other'}
              onChange={(e) =>
                onPatch({ task_kind: e.target.value as 'call' | 'text' | 'email' | 'meeting' | 'note' | 'other' } as Partial<AutomationAction>)
              }
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            >
              <option value="call">Call</option>
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
              <option value="note">Note</option>
              <option value="other">Other</option>
            </select>
            <select
              value={action.use_callback_at ? 'callback' : action.due_in_minutes ? 'in' : 'none'}
              onChange={(e) => {
                const v = e.target.value;
                if (v === 'callback') {
                  onPatch({
                    use_callback_at: true,
                    due_in_minutes: undefined,
                  } as Partial<AutomationAction>);
                } else if (v === 'in') {
                  onPatch({
                    use_callback_at: false,
                    due_in_minutes: action.due_in_minutes ?? 60,
                  } as Partial<AutomationAction>);
                } else {
                  onPatch({
                    use_callback_at: false,
                    due_in_minutes: undefined,
                  } as Partial<AutomationAction>);
                }
              }}
              className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            >
              <option value="none">No due date</option>
              <option value="callback">At callback time</option>
              <option value="in">In N minutes…</option>
            </select>
          </div>
          {!action.use_callback_at && typeof action.due_in_minutes === 'number' && (
            <input
              type="number"
              min={1}
              value={action.due_in_minutes}
              onChange={(e) =>
                onPatch({ due_in_minutes: Number(e.target.value) || 0 } as Partial<AutomationAction>)
              }
              placeholder="Minutes from now"
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            />
          )}
          <label className="flex items-center gap-2 text-[11.5px] text-txt-2">
            <input
              type="checkbox"
              checked={action.assign_to_caller ?? false}
              onChange={(e) =>
                onPatch({ assign_to_caller: e.target.checked } as Partial<AutomationAction>)
              }
            />
            Assign to the agent who took the call
          </label>
        </div>
      )}
    </div>
  );
}

function labelFor(kind: AutomationAction['kind']): string {
  switch (kind) {
    case 'move_stage':
      return 'Move lead to stage';
    case 'mark_dnc':
      return 'Mark Do Not Call';
    case 'add_tag':
      return 'Add tag';
    case 'create_task':
      return 'Create task';
  }
}
