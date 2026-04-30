'use client';

// Manager-only CRUD for the brand's automations. Each row is a trigger →
// actions rule that the engine fires synchronously after the upstream
// server action persists. Toggle off to disable without deleting; system
// rows are seeded defaults but still fully editable / removable. Drag the
// grip handle on the left of any row to reorder.

import Link from 'next/link';
import type { Route } from 'next';
import { useState, useTransition } from 'react';
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
import {
  bulkDeleteAutomations,
  bulkSetAutomationsEnabled,
  createBlankAutomation,
  deleteAutomation,
  reorderAutomations,
  setAutomationEnabled,
} from '@/app/actions/automations';
import { describeAction, type Automation } from '@/lib/automation-types';

export type StageRef = { id: string; name: string };
export type TagRef = { id: string; name: string };
export type DispositionRef = { code: string; label: string };

type Props = {
  initial: Automation[];
  stages: StageRef[];
  tags: TagRef[];
  dispositions: DispositionRef[];
};

export function AutomationsManager({ initial, stages, tags, dispositions }: Props) {
  const [items, setItems] = useState<Automation[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function toggleSelected(id: string) {
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
  function selectAll() {
    setSelected(new Set(items.map((a) => a.id)));
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} automation${ids.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await bulkDeleteAutomations({ ids });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((a) => !selected.has(a.id)));
      clearSelection();
    });
  }
  async function bulkEnable(enabled: boolean) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await bulkSetAutomationsEnabled({ ids, enabled });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.map((a) => (selected.has(a.id) ? { ...a, isEnabled: enabled } : a)));
      clearSelection();
    });
  }

  // Canvas-first creation: drops a blank workflow with no trigger configured
  // and lands the user directly in the visual editor. The action redirects
  // server-side, so the browser navigates without a separate router round
  // trip — feels instant. We only get a return value on the error branch.
  async function newBlankWorkflow() {
    if (creating) return;
    setError(null);
    setCreating(true);
    const res = await createBlankAutomation();
    if (res && !res.ok) {
      setCreating(false);
      setError(res.error);
    }
    // On success the action redirects, the page tears down, and creating
    // stays true through the unmount — fine.
  }

  // 5px activation distance avoids hijacking clicks on the toggle / Open
  // editor / Delete controls that share the row.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function toggleEnabled(id: string, enabled: boolean) {
    setError(null);
    setItems((prev) => prev.map((a) => (a.id === id ? { ...a, isEnabled: enabled } : a)));
    startTransition(async () => {
      const res = await setAutomationEnabled({ id, enabled });
      if (!res.ok) setError(res.error);
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((a) => a.id === active.id);
    const to = items.findIndex((a) => a.id === over.id);
    if (from < 0 || to < 0) return;
    const reordered = arrayMove(items, from, to);
    setItems(reordered);
    startTransition(async () => {
      const res = await reorderAutomations({ ids: reordered.map((a) => a.id) });
      if (!res.ok) setError(res.error);
    });
  }

  function remove(a: Automation) {
    setError(null);
    if (!window.confirm(`Delete "${a.name}"? This can't be undone.`)) return;
    startTransition(async () => {
      const res = await deleteAutomation({ id: a.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== a.id));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-txt-3">
          Triggers fire synchronously when the upstream event happens. Drag the grip to reorder; actions run top-to-bottom.
        </p>
        <button
          type="button"
          disabled={creating}
          onClick={() => newBlankWorkflow()}
          className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'New automation'}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal/40 bg-teal/5 px-3 py-2 text-[12px]">
          <span className="font-medium text-txt-1">
            {selected.size} selected
          </span>
          <span className="mx-1 h-4 w-px bg-line" />
          <button
            type="button"
            onClick={() => bulkEnable(true)}
            className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] hover:bg-surface-2"
          >
            Enable
          </button>
          <button
            type="button"
            onClick={() => bulkEnable(false)}
            className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] hover:bg-surface-2"
          >
            Disable
          </button>
          <button
            type="button"
            onClick={bulkDelete}
            className="rounded-md border border-hp/40 bg-hp/10 px-2.5 py-1 text-[11.5px] text-hp hover:bg-hp/20"
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

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12.5px] text-txt-3">
            No automations yet. Create one to react to call dispositions.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line bg-canvas px-4 py-2 text-[11.5px] text-txt-3">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={selected.size > 0 && selected.size === items.length}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && selected.size < items.length;
                }}
                onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                className="h-3.5 w-3.5 cursor-pointer accent-teal"
              />
              <span>{items.length} workflow{items.length === 1 ? '' : 's'}</span>
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={items.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                {items.map((a) => (
                  <SortableAutomationRow
                    key={a.id}
                    automation={a}
                    stages={stages}
                    tags={tags}
                    dispositions={dispositions}
                    selected={selected.has(a.id)}
                    onSelectChange={() => toggleSelected(a.id)}
                    onToggle={(enabled) => toggleEnabled(a.id, enabled)}
                    onDelete={() => remove(a)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>

    </div>
  );
}

function SortableAutomationRow(props: {
  automation: Automation;
  stages: StageRef[];
  tags: TagRef[];
  dispositions: DispositionRef[];
  selected: boolean;
  onSelectChange: () => void;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const { automation } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: automation.id,
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
      className={`relative grid grid-cols-[20px_28px_1fr_auto] items-start gap-3 border-b border-line/60 px-3 py-3 last:border-b-0 ${
        props.selected ? 'bg-teal/5' : 'bg-surface'
      } ${isDragging ? 'shadow-lg ring-1 ring-teal/30' : ''}`}
    >
      <input
        type="checkbox"
        aria-label={`Select ${automation.name}`}
        checked={props.selected}
        onChange={props.onSelectChange}
        className="mt-2 h-3.5 w-3.5 cursor-pointer accent-teal"
      />
      <button
        type="button"
        aria-label={`Drag ${automation.name}`}
        {...attributes}
        {...listeners}
        className="mt-1 grid h-7 w-7 cursor-grab touch-none place-items-center rounded text-txt-3 hover:bg-canvas hover:text-txt-1 active:cursor-grabbing"
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

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[13px] font-medium">{automation.name}</h3>
          {automation.isSystem && (
            <span className="rounded-full border border-line bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-txt-3">
              Default
            </span>
          )}
          {!automation.isEnabled && (
            <span className="rounded-full border border-hp/30 bg-hp/10 px-1.5 py-0.5 text-[10px] font-medium text-hp">
              Off
            </span>
          )}
        </div>
        <div className="mt-1 text-[11.5px] text-txt-3">
          <TriggerSummary
            triggerType={automation.triggerType}
            config={automation.triggerConfig}
            dispositions={props.dispositions}
          />
        </div>
        {automation.description && (
          <p className="mt-1 text-[11.5px] text-txt-2">{automation.description}</p>
        )}
        <ul className="mt-2 space-y-1">
          {automation.actions.map((a, i) => (
            <li key={i} className="flex items-center gap-2 text-[12px] text-txt-1">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-teal/10 text-[9px] font-semibold text-teal">
                {i + 1}
              </span>
              {describeAction(a, { stages: props.stages, tags: props.tags })}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-1.5">
        {automation.mode === 'graph' && (
          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
            Visual
          </span>
        )}
        <Toggle enabled={automation.isEnabled} onChange={props.onToggle} />
        <Link
          href={`/workflows/${automation.id}` as Route}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] hover:bg-surface-2"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-4M14 3h7v7M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Open editor
        </Link>
        <button
          type="button"
          onClick={props.onDelete}
          aria-label={`Delete ${automation.name}`}
          className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-hp/10 hover:text-hp"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-teal' : 'bg-line'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function TriggerSummary({
  triggerType,
  config,
  dispositions,
}: {
  triggerType: string;
  config: Record<string, unknown>;
  dispositions: DispositionRef[];
}) {
  if (triggerType === 'disposition_set') {
    const codes = Array.isArray(config.codes) ? (config.codes as string[]) : [];
    const labels = codes.map((c) => dispositions.find((d) => d.code === c)?.label ?? c);
    return (
      <span>
        When disposition is{' '}
        <span className="font-medium text-txt-1">
          {labels.length === 0 ? '(none)' : labels.join(', ')}
        </span>
      </span>
    );
  }
  return <span>Trigger: {triggerType}</span>;
}
