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
import { useRouter } from 'next/navigation';
import {
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
  const router = useRouter();
  const [items, setItems] = useState<Automation[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();

  // Canvas-first creation: drops a blank workflow in graph mode and lands the
  // user directly in the visual editor. Avoids the modal-form detour the user
  // didn't want.
  async function newBlankWorkflow(triggerType: 'disposition_set' | 'webhook_received') {
    if (creating) return;
    setError(null);
    setCreating(true);
    const res = await createBlankAutomation({ triggerType });
    setCreating(false);
    if (!res.ok || !res.id) {
      setError(res.ok ? 'Could not create workflow.' : res.error);
      return;
    }
    router.push(`/workflows/${res.id}` as Route);
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={creating}
            onClick={() => newBlankWorkflow('webhook_received')}
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50"
          >
            New webhook workflow
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => newBlankWorkflow('disposition_set')}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'New automation'}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {items.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12.5px] text-txt-3">
            No automations yet. Create one to react to call dispositions.
          </div>
        ) : (
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
                  onToggle={(enabled) => toggleEnabled(a.id, enabled)}
                  onDelete={() => remove(a)}
                />
              ))}
            </SortableContext>
          </DndContext>
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
      className={`relative grid grid-cols-[28px_1fr_auto] items-start gap-3 border-b border-line/60 bg-surface px-3 py-3 last:border-b-0 ${
        isDragging ? 'shadow-lg ring-1 ring-teal/30' : ''
      }`}
    >
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
