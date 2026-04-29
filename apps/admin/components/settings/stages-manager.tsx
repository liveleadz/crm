'use client';

import { useState, useTransition } from 'react';
import {
  createStage,
  deleteStage,
  reorderStages,
  updateStage,
} from '@/app/actions/stages';
import type { LeadStage } from '@/lib/leads';

const COLORS = ['teal', 'hp', 'vl', 'bs', 'll', 'hb', 'bi'] as const;
type StageColor = (typeof COLORS)[number] | '';

const DOT_CLASS: Record<string, string> = {
  teal: 'bg-teal',
  hp: 'bg-hp',
  vl: 'bg-vl',
  bs: 'bg-bs',
  ll: 'bg-ll',
  hb: 'bg-hb',
  bi: 'bg-bi',
};

function dotClass(color: string | null) {
  return (color && DOT_CLASS[color]) ?? 'bg-txt-3';
}

export function StagesManager({ initialStages }: { initialStages: LeadStage[] }) {
  const [stages, setStages] = useState(
    [...initialStages].sort((a, b) => a.position - b.position),
  );
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function applyServerResult(res: { ok: true } | { ok: false; error: string }) {
    if (!res.ok) setError(res.error);
  }

  function move(id: string, direction: -1 | 1) {
    setError(null);
    const idx = stages.findIndex((s) => s.id === id);
    const next = idx + direction;
    if (idx < 0 || next < 0 || next >= stages.length) return;
    const reordered = [...stages];
    const tmp = reordered[idx]!;
    reordered[idx] = reordered[next]!;
    reordered[next] = tmp;
    setStages(reordered);
    startTransition(async () => {
      const res = await reorderStages(reordered.map((s) => s.id));
      if (!res.ok) {
        // Revert
        setStages(stages);
        setError(res.error);
      }
    });
  }

  function patchLocal(id: string, patch: Partial<LeadStage>) {
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function rename(id: string, name: string) {
    setError(null);
    startTransition(async () => {
      applyServerResult(await updateStage(id, { name }));
    });
  }

  function changeColor(id: string, color: StageColor) {
    setError(null);
    patchLocal(id, { color: color === '' ? null : color });
    startTransition(async () => {
      applyServerResult(await updateStage(id, { color: color === '' ? null : color }));
    });
  }

  function toggleFlag(id: string, flag: 'isWon' | 'isLost') {
    setError(null);
    const stage = stages.find((s) => s.id === id);
    if (!stage) return;
    const next = !stage[flag];
    patchLocal(id, { [flag]: next });
    startTransition(async () => {
      applyServerResult(await updateStage(id, { [flag]: next }));
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteStage(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStages((prev) => prev.filter((s) => s.id !== id));
    });
  }

  return (
    <div className="space-y-4">
      <AddStage
        onAdded={(stage) => setStages((prev) => [...prev, stage])}
        onError={setError}
      />
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-[28px_1fr_120px_70px_70px_60px_36px] items-center gap-3 border-b border-line bg-canvas px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          <span></span>
          <span>Name</span>
          <span>Color</span>
          <span>Won</span>
          <span>Lost</span>
          <span>Position</span>
          <span></span>
        </div>
        {stages.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12.5px] text-txt-3">
            No stages yet. Add one above.
          </div>
        ) : (
          stages.map((s, i) => (
            <div
              key={s.id}
              className="grid grid-cols-[28px_1fr_120px_70px_70px_60px_36px] items-center gap-3 border-b border-line/60 px-3 py-2.5 last:border-b-0"
            >
              <span className={`h-2.5 w-2.5 rounded-full ${dotClass(s.color)}`} />
              <input
                type="text"
                defaultValue={s.name}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v && v !== s.name) {
                    patchLocal(s.id, { name: v });
                    rename(s.id, v);
                  } else if (!v) {
                    e.currentTarget.value = s.name;
                  }
                }}
                className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[12.5px] hover:border-line focus:border-teal/60 focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-teal/20"
              />
              <select
                value={(s.color as StageColor) ?? ''}
                onChange={(e) => changeColor(s.id, e.target.value as StageColor)}
                className="rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
              >
                <option value="">none</option>
                {COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={s.isWon}
                  onChange={() => toggleFlag(s.id, 'isWon')}
                  className="h-4 w-4 rounded border-line accent-ll"
                />
              </label>
              <label className="flex items-center justify-center">
                <input
                  type="checkbox"
                  checked={s.isLost}
                  onChange={() => toggleFlag(s.id, 'isLost')}
                  className="h-4 w-4 rounded border-line accent-hp"
                />
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(s.id, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="grid h-6 w-6 place-items-center rounded text-txt-3 hover:bg-canvas disabled:opacity-30"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M6 15l6-6 6 6" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => move(s.id, 1)}
                  disabled={i === stages.length - 1}
                  aria-label="Move down"
                  className="grid h-6 w-6 place-items-center rounded text-txt-3 hover:bg-canvas disabled:opacity-30"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                onClick={() => remove(s.id)}
                aria-label={`Delete ${s.name}`}
                className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-hp/10 hover:text-hp"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AddStage({
  onAdded,
  onError,
}: {
  onAdded: (s: LeadStage) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<StageColor>('');
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    startTransition(async () => {
      const res = await createStage({ name: trimmed, color: color || null });
      setSaving(false);
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onAdded(res.stage);
      setName('');
      setColor('');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="New stage name"
        className="flex-1 min-w-[200px] rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      />
      <select
        value={color}
        onChange={(e) => setColor(e.target.value as StageColor)}
        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      >
        <option value="">no color</option>
        {COLORS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={saving || !name.trim()}
        className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
      >
        {saving ? 'Adding…' : 'Add stage'}
      </button>
    </div>
  );
}
