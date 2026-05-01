'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  bulkAddTagToLeads,
  bulkDeleteLeads,
  bulkMoveLeadsStage,
  bulkRemoveTagFromLeads,
  bulkSetLeadsConsent,
  moveLeadStage,
} from '@/app/actions/leads';
import type { LeadCard, LeadStage } from '@/lib/leads';
import { LeadDetailDrawer } from './lead-detail-drawer';
import { TagChip } from '@/components/tags/tag-chip';

const STAGE_DOT: Record<string, string> = {
  teal: 'bg-teal',
  hp: 'bg-hp',
  vl: 'bg-vl',
  bs: 'bg-bs',
  ll: 'bg-ll',
  hb: 'bg-hb',
  bi: 'bg-bi',
};

function dotClass(color: string | null) {
  return (color && STAGE_DOT[color]) ?? 'bg-txt-3';
}

function initials(first: string | null, last: string | null) {
  const f = first?.[0] ?? '';
  const l = last?.[0] ?? '';
  return (f + l).toUpperCase() || '··';
}

function fullName(l: LeadCard) {
  const name = [l.firstName, l.lastName].filter(Boolean).join(' ').trim();
  return name || 'Unnamed lead';
}

function timeAgo(iso: string) {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export function KanbanBoard({
  stages,
  leads: initialLeads,
  tags,
  team = [],
}: {
  stages: LeadStage[];
  leads: LeadCard[];
  tags?: { id: string; name: string }[];
  team?: { id: string; name: string }[];
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  // Selection mode swaps card-drag for card-checkboxes. While active, click
  // toggles selection instead of opening the drawer, and drag-to-stage is
  // disabled to keep the gestures unambiguous.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync local state when the server prop changes (e.g. after createLead +
  // router.refresh() or after revalidatePath rebuilds the parent RSC).
  useEffect(() => {
    setLeads(initialLeads);
  }, [initialLeads]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function onDragEnd(e: DragEndEvent) {
    const leadId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const stageId = overId.startsWith('stage:') ? overId.slice('stage:'.length) : null;
    if (!stageId) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;

    // Optimistic
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stageId } : l)));
    startTransition(async () => {
      const res = await moveLeadStage(leadId, stageId);
      if (!res.ok) {
        // Revert on failure
        setLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, stageId: lead.stageId } : l)),
        );
      }
    });
  }

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
  function exitSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}? This can't be undone.`))
      return;
    setError(null);
    startTransition(async () => {
      const res = await bulkDeleteLeads({ ids });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLeads((prev) => prev.filter((l) => !selected.has(l.id)));
      clearSelection();
    });
  }
  async function bulkMove(stageId: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await bulkMoveLeadsStage({ ids, stageId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLeads((prev) => prev.map((l) => (selected.has(l.id) ? { ...l, stageId } : l)));
      clearSelection();
    });
  }
  async function bulkTag(tagId: string, mode: 'add' | 'remove') {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res =
        mode === 'add'
          ? await bulkAddTagToLeads({ ids, tagId })
          : await bulkRemoveTagFromLeads({ ids, tagId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Reflect tag changes locally without refetching. We need the tag's
      // name/color from the picker; lookup by id and add/remove on the cards.
      const tag = (tags ?? []).find((t) => t.id === tagId);
      if (!tag) {
        clearSelection();
        return;
      }
      setLeads((prev) =>
        prev.map((l) => {
          if (!selected.has(l.id)) return l;
          if (mode === 'add') {
            if (l.tags.some((t) => t.id === tag.id)) return l;
            return { ...l, tags: [...l.tags, { id: tag.id, name: tag.name, color: '' }] };
          }
          return { ...l, tags: l.tags.filter((t) => t.id !== tag.id) };
        }),
      );
      clearSelection();
    });
  }
  async function bulkDnc(value: boolean) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await bulkSetLeadsConsent({ ids, doNotCall: value });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLeads((prev) => prev.map((l) => (selected.has(l.id) ? { ...l, doNotCall: value } : l)));
      clearSelection();
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <div className="text-[11.5px] text-txt-3">
          {leads.length} lead{leads.length === 1 ? '' : 's'}
        </div>
        <button
          type="button"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          className={`rounded-md border px-2.5 py-1 text-[11.5px] font-medium ${
            selectMode
              ? 'border-teal/60 bg-teal/10 text-teal'
              : 'border-line bg-canvas hover:bg-surface-2'
          }`}
        >
          {selectMode ? 'Exit select' : 'Select'}
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}

      {selectMode && selected.size > 0 && (
        <BulkBar
          selectedCount={selected.size}
          stages={stages}
          tags={tags ?? []}
          onClear={clearSelection}
          onDelete={bulkDelete}
          onMove={bulkMove}
          onTag={(id) => bulkTag(id, 'add')}
          onUntag={(id) => bulkTag(id, 'remove')}
          onDnc={() => bulkDnc(true)}
          onUndnc={() => bulkDnc(false)}
        />
      )}

      <DndContext id="kanban-board" sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-w-max gap-3 p-4">
          {stages.map((s) => (
            <StageColumn
              key={s.id}
              stage={s}
              leads={leads.filter((l) => l.stageId === s.id)}
              onOpen={setOpenLeadId}
              selectMode={selectMode}
              selected={selected}
              onSelectChange={toggleSelected}
            />
          ))}
        </div>
      </DndContext>
      <LeadDetailDrawer
        leadId={openLeadId}
        stages={stages}
        team={team}
        onClose={() => setOpenLeadId(null)}
      />
    </>
  );
}

function BulkBar({
  selectedCount,
  stages,
  tags,
  onClear,
  onDelete,
  onMove,
  onTag,
  onUntag,
  onDnc,
  onUndnc,
}: {
  selectedCount: number;
  stages: LeadStage[];
  tags: { id: string; name: string }[];
  onClear: () => void;
  onDelete: () => void;
  onMove: (stageId: string) => void;
  onTag: (tagId: string) => void;
  onUntag: (tagId: string) => void;
  onDnc: () => void;
  onUndnc: () => void;
}) {
  return (
    <div className="mx-4 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-teal/40 bg-teal/5 px-3 py-2 text-[12px]">
      <span className="font-medium text-txt-1">{selectedCount} selected</span>
      <span className="mx-1 h-4 w-px bg-line" />
      <select
        defaultValue=""
        onChange={(e) => {
          if (!e.target.value) return;
          onMove(e.target.value);
          e.currentTarget.value = '';
        }}
        className="rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px]"
      >
        <option value="">Move to stage…</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {tags.length > 0 && (
        <>
          <select
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              onTag(e.target.value);
              e.currentTarget.value = '';
            }}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px]"
          >
            <option value="">Add tag…</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              onUntag(e.target.value);
              e.currentTarget.value = '';
            }}
            className="rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px]"
          >
            <option value="">Remove tag…</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      )}
      <button
        type="button"
        onClick={onDnc}
        className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] hover:bg-surface-2"
      >
        Mark DNC
      </button>
      <button
        type="button"
        onClick={onUndnc}
        className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] hover:bg-surface-2"
      >
        Clear DNC
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="rounded-md border border-hp/40 bg-hp/10 px-2.5 py-1 text-[11.5px] text-hp hover:bg-hp/20"
      >
        Delete
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto rounded-md px-2 py-1 text-[11.5px] text-txt-3 hover:text-txt-1"
      >
        Clear
      </button>
    </div>
  );
}

function StageColumn({
  stage,
  leads,
  onOpen,
  selectMode,
  selected,
  onSelectChange,
}: {
  stage: LeadStage;
  leads: LeadCard[];
  onOpen: (id: string) => void;
  selectMode: boolean;
  selected: Set<string>;
  onSelectChange: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stage.id}` });
  return (
    <div className="flex w-[260px] shrink-0 flex-col rounded-2xl border border-line bg-canvas">
      <div className="flex h-10 items-center gap-2 border-b border-line px-3">
        <span className={`h-2 w-2 rounded-full ${dotClass(stage.color)}`} />
        <span className="text-[12.5px] font-semibold">{stage.name}</span>
        <span className="ml-auto font-mono text-[11px] text-txt-3">{leads.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`min-h-[200px] flex-1 space-y-2 p-2 transition-colors ${
          isOver && !selectMode ? 'bg-teal/5 ring-2 ring-teal/30' : ''
        }`}
      >
        {leads.length === 0 ? (
          <div className="grid h-20 place-items-center rounded-lg border border-dashed border-line text-[11px] text-txt-3">
            Drop here
          </div>
        ) : (
          leads.map((l) => (
            <DraggableLead
              key={l.id}
              lead={l}
              onOpen={onOpen}
              selectMode={selectMode}
              selected={selected.has(l.id)}
              onSelectChange={() => onSelectChange(l.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function DraggableLead({
  lead,
  onOpen,
  selectMode,
  selected,
  onSelectChange,
}: {
  lead: LeadCard;
  onOpen: (id: string) => void;
  selectMode: boolean;
  selected: boolean;
  onSelectChange: () => void;
}) {
  // In select mode the card is non-draggable so a click toggles selection.
  // Outside select mode the existing drag-to-stage gesture stays untouched.
  const draggable = useDraggable({ id: lead.id, disabled: selectMode });
  const { attributes, listeners, setNodeRef, transform, isDragging } = draggable;
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(selectMode ? {} : listeners)}
      {...(selectMode ? {} : attributes)}
      onClick={() => {
        if (selectMode) onSelectChange();
        else if (!isDragging) onOpen(lead.id);
      }}
      className={`relative rounded-xl border bg-surface p-3 ${
        selectMode
          ? `cursor-pointer ${selected ? 'border-teal ring-2 ring-teal/30' : 'border-line hover:border-teal/40'}`
          : `cursor-grab border-line active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`
      }`}
    >
      {selectMode && (
        <input
          type="checkbox"
          aria-label="Select lead"
          checked={selected}
          onChange={onSelectChange}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-2 top-2 h-3.5 w-3.5 cursor-pointer accent-teal"
        />
      )}
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-teal/15 text-[11px] font-semibold text-teal">
          {initials(lead.firstName, lead.lastName)}
        </div>
        <span className="flex-1 truncate text-[12.5px] font-medium">{fullName(lead)}</span>
      </div>
      {lead.phone && (
        <div className="mt-2 font-mono text-[11.5px] text-txt-2">{lead.phone}</div>
      )}
      {lead.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.tags.slice(0, 4).map((t) => (
            <TagChip key={t.id} name={t.name} color={t.color} size="xs" />
          ))}
          {lead.tags.length > 4 && (
            <span className="text-[10px] text-txt-3">+{lead.tags.length - 4}</span>
          )}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-txt-3">
        <span className="capitalize">{lead.source}</span>
        {(lead.doNotCall || lead.doNotEmail) && (
          <span className="rounded border border-line px-1 font-medium text-txt-2">
            {[lead.doNotCall && 'DNC', lead.doNotEmail && 'DNE'].filter(Boolean).join('·')}
          </span>
        )}
        <span className="ml-auto">{timeAgo(lead.updatedAt)}</span>
      </div>
    </div>
  );
}
