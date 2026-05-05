'use client';

// Manager-only CRUD for the brand's call dispositions. Reorder via the
// up/down arrows; archive instead of hard-delete so historical calls
// keep their label resolvable.

import { useState, useTransition } from 'react';
import {
  archiveDisposition,
  createDisposition,
  reorderDispositions,
  setDispositionCategory,
  setDispositionCooldown,
  updateDisposition,
} from '@/app/actions/dispositions';
import {
  DISPOSITION_CATEGORIES,
  DISPOSITION_CATEGORY_LABELS,
  type Disposition,
  type DispositionCategory,
  type DispositionTone,
} from '@/lib/dispositions-shared';

const TONE_DOT: Record<DispositionTone, string> = {
  good: 'bg-teal',
  neutral: 'bg-txt-3/50',
  bad: 'bg-hp',
};

const TONE_OPTIONS: { value: DispositionTone; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'bad', label: 'Bad' },
];

const CATEGORY_OPTIONS: { value: DispositionCategory; label: string }[] =
  DISPOSITION_CATEGORIES.map((c) => ({ value: c, label: DISPOSITION_CATEGORY_LABELS[c] }));

export function DispositionsManager({ initial }: { initial: Disposition[] }) {
  const [items, setItems] = useState<Disposition[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function patch(id: string, p: Partial<Disposition>) {
    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  }

  function rename(id: string, label: string) {
    setError(null);
    const trimmed = label.trim();
    if (!trimmed) return;
    const current = items.find((d) => d.id === id);
    if (!current || current.label === trimmed) return;
    patch(id, { label: trimmed });
    startTransition(async () => {
      const res = await updateDisposition({ id, label: trimmed, tone: current.tone });
      if (!res.ok) setError(res.error);
    });
  }

  function changeTone(id: string, tone: DispositionTone) {
    setError(null);
    const current = items.find((d) => d.id === id);
    if (!current) return;
    patch(id, { tone });
    startTransition(async () => {
      const res = await updateDisposition({ id, label: current.label, tone });
      if (!res.ok) setError(res.error);
    });
  }

  function changeCategory(id: string, category: DispositionCategory) {
    setError(null);
    patch(id, { category });
    startTransition(async () => {
      const res = await setDispositionCategory({ id, category });
      if (!res.ok) setError(res.error);
    });
  }

  function changeCooldown(id: string, raw: string) {
    setError(null);
    const trimmed = raw.trim();
    const minutes = trimmed === '' ? null : Number(trimmed);
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) {
      setError('Cooldown must be a positive number of minutes.');
      return;
    }
    patch(id, { cooldownMinutes: minutes });
    startTransition(async () => {
      const res = await setDispositionCooldown({ id, minutes });
      if (!res.ok) setError(res.error);
    });
  }

  function move(id: string, dir: -1 | 1) {
    const idx = items.findIndex((d) => d.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= items.length) return;
    const reordered = [...items];
    const [moved] = reordered.splice(idx, 1);
    if (!moved) return;
    reordered.splice(next, 0, moved);
    setItems(reordered);
    startTransition(async () => {
      const res = await reorderDispositions({ ids: reordered.map((d) => d.id) });
      if (!res.ok) setError(res.error);
    });
  }

  function remove(d: Disposition) {
    setError(null);
    if (!window.confirm(`Archive "${d.label}"? Existing calls keep this label, but agents will no longer see it.`)) {
      return;
    }
    startTransition(async () => {
      const res = await archiveDisposition({ id: d.id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((x) => x.id !== d.id));
    });
  }

  return (
    <div className="space-y-4">
      <AddDisposition
        existing={items}
        onAdded={(d) => setItems((prev) => [...prev, d])}
        onError={setError}
      />
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}
      {(() => {
        const otherCount = items.filter((d) => d.category === 'other').length;
        if (otherCount === 0) return null;
        return (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-txt-2">
            <span className="font-medium">{otherCount}</span>{' '}
            disposition{otherCount === 1 ? '' : 's'} set to{' '}
            <span className="font-mono">Other</span> — pick a category so they
            roll up in report KPIs.
          </div>
        );
      })()}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-[60px_1fr_120px_100px_140px_100px_36px] items-center gap-3 border-b border-line bg-canvas px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          <span>Order</span>
          <span>Label</span>
          <span>Code</span>
          <span>Tone</span>
          <span title="Fixed metric bucket the reports layer aggregates against. Rename your label freely; categories keep your KPIs stable.">Category</span>
          <span title="Suppress redial of this lead for N minutes after a call resolves with this disposition.">Cooldown</span>
          <span></span>
        </div>
        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12.5px] text-txt-3">
            No dispositions yet. Add one above.
          </div>
        ) : (
          items.map((d, i) => (
            <div
              key={d.id}
              className="grid grid-cols-[60px_1fr_120px_100px_140px_100px_36px] items-center gap-3 border-b border-line/60 px-3 py-2.5 last:border-b-0"
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(d.id, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="grid h-6 w-6 place-items-center rounded text-txt-3 hover:bg-canvas hover:text-txt-1 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => move(d.id, 1)}
                  disabled={i === items.length - 1}
                  aria-label="Move down"
                  className="grid h-6 w-6 place-items-center rounded text-txt-3 hover:bg-canvas hover:text-txt-1 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[d.tone]}`} />
                <input
                  type="text"
                  defaultValue={d.label}
                  onBlur={(e) => {
                    const v = e.currentTarget.value.trim();
                    if (v && v !== d.label) rename(d.id, v);
                    else if (!v) e.currentTarget.value = d.label;
                  }}
                  className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[12.5px] hover:border-line focus:border-teal/60 focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-teal/20"
                />
              </div>
              <span className="font-mono text-[11px] text-txt-3">{d.code}</span>
              <select
                value={d.tone}
                onChange={(e) => changeTone(d.id, e.target.value as DispositionTone)}
                className="rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
              >
                {TONE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select
                value={d.category}
                onChange={(e) => changeCategory(d.id, e.target.value as DispositionCategory)}
                title={
                  d.category === 'other'
                    ? "Pick a standard category. 'Other' is excluded from the outcome mix on report KPIs."
                    : undefined
                }
                className={`rounded-md border bg-canvas px-2 py-1 text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20 ${
                  d.category === 'other' ? 'border-amber-500/60' : 'border-line'
                }`}
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={d.cooldownMinutes ?? ''}
                  placeholder="—"
                  onBlur={(e) => {
                    const v = e.currentTarget.value;
                    const next = v.trim() === '' ? null : Number(v);
                    if (next === d.cooldownMinutes) return;
                    changeCooldown(d.id, v);
                  }}
                  className="w-14 rounded-md border border-line bg-canvas px-2 py-1 text-right text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
                />
                <span className="text-[10.5px] text-txt-3">min</span>
              </div>
              <button
                type="button"
                onClick={() => remove(d)}
                aria-label={`Archive ${d.label}`}
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

// Auto-derive a code slug from the label. Manager-overridable in case
// of collisions.
function slug(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, '_$1');
}

function AddDisposition({
  existing,
  onAdded,
  onError,
}: {
  existing: Disposition[];
  onAdded: (d: Disposition) => void;
  onError: (msg: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [tone, setTone] = useState<DispositionTone>('neutral');
  const [category, setCategory] = useState<DispositionCategory>('other');
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) return;
    const finalCode = code.trim() || slug(trimmed);
    if (existing.some((d) => d.code === finalCode)) {
      onError(`Code "${finalCode}" already exists.`);
      return;
    }
    setSaving(true);
    startTransition(async () => {
      const res = await createDisposition({ code: finalCode, label: trimmed, tone, category });
      setSaving(false);
      if (!res.ok) {
        onError(res.error);
        return;
      }
      // Optimistic — the server-generated id we don't know yet, so append
      // a placeholder; the next page reload will sync. Most adds happen
      // after a fresh load anyway.
      onAdded({
        id: `pending-${finalCode}`,
        code: finalCode,
        label: trimmed,
        tone,
        category,
        sortOrder: (existing.at(-1)?.sortOrder ?? 0) + 1,
        cooldownMinutes: null,
      });
      setLabel('');
      setCode('');
      setTone('neutral');
      setCategory('other');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="New disposition label (e.g. Booked appointment)"
        className="flex-1 min-w-[220px] rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      />
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="code (auto)"
        className="w-32 rounded-lg border border-line bg-canvas px-2.5 py-1.5 font-mono text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      />
      <select
        value={tone}
        onChange={(e) => setTone(e.target.value as DispositionTone)}
        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      >
        {TONE_OPTIONS.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as DispositionCategory)}
        title="Metric category — keeps reports stable when you rename labels."
        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      >
        {CATEGORY_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={saving || !label.trim()}
        className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
      >
        {saving ? 'Adding…' : 'Add'}
      </button>
    </div>
  );
}
