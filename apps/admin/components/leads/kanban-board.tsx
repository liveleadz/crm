'use client';

import { useState, useTransition } from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { moveLeadStage } from '@/app/actions/leads';
import type { LeadCard, LeadStage } from '@/lib/leads';

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
}: {
  stages: LeadStage[];
  leads: LeadCard[];
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [, startTransition] = useTransition();
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

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex min-w-max gap-3 p-4">
        {stages.map((s) => (
          <StageColumn
            key={s.id}
            stage={s}
            leads={leads.filter((l) => l.stageId === s.id)}
          />
        ))}
      </div>
    </DndContext>
  );
}

function StageColumn({ stage, leads }: { stage: LeadStage; leads: LeadCard[] }) {
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
          isOver ? 'bg-teal/5 ring-2 ring-teal/30' : ''
        }`}
      >
        {leads.length === 0 ? (
          <div className="grid h-20 place-items-center rounded-lg border border-dashed border-line text-[11px] text-txt-3">
            Drop here
          </div>
        ) : (
          leads.map((l) => <DraggableLead key={l.id} lead={l} />)
        )}
      </div>
    </div>
  );
}

function DraggableLead({ lead }: { lead: LeadCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`relative cursor-grab rounded-xl border border-line bg-surface p-3 active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="grid h-7 w-7 place-items-center rounded-full bg-teal/15 text-[11px] font-semibold text-teal">
          {initials(lead.firstName, lead.lastName)}
        </div>
        <span className="flex-1 truncate text-[12.5px] font-medium">{fullName(lead)}</span>
      </div>
      {lead.phone && (
        <div className="mt-2 font-mono text-[11.5px] text-txt-2">{lead.phone}</div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-txt-3">
        <span className="capitalize">{lead.source}</span>
        <span className="ml-auto">{timeAgo(lead.updatedAt)}</span>
      </div>
    </div>
  );
}
