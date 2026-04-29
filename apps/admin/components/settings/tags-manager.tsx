'use client';

import { useState, useTransition } from 'react';
import { deleteTag, getOrCreateTag, renameTag, setTagColor } from '@/app/actions/tags';
import { TagChip } from '@/components/tags/tag-chip';
import { TAG_COLORS, type TagColor } from '@/components/tags/tag-palette';
import type { TagWithCount } from '@/lib/tags';

export function TagsManager({ initialTags }: { initialTags: TagWithCount[] }) {
  const [tags, setTags] = useState<TagWithCount[]>(initialTags);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function patch(id: string, p: Partial<TagWithCount>) {
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...p } : t)));
  }

  function rename(id: string, name: string) {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return;
    patch(id, { name: trimmed });
    startTransition(async () => {
      const res = await renameTag(id, trimmed);
      if (!res.ok) setError(res.error);
    });
  }

  function changeColor(id: string, color: TagColor) {
    setError(null);
    patch(id, { color });
    startTransition(async () => {
      const res = await setTagColor(id, color);
      if (!res.ok) setError(res.error);
    });
  }

  function remove(t: TagWithCount) {
    setError(null);
    const msg =
      t.leadCount > 0
        ? `Delete "${t.name}"? This will detach it from ${t.leadCount} lead${t.leadCount === 1 ? '' : 's'}.`
        : `Delete "${t.name}"?`;
    if (!window.confirm(msg)) return;
    startTransition(async () => {
      const res = await deleteTag(t.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTags((prev) => prev.filter((x) => x.id !== t.id));
    });
  }

  return (
    <div className="space-y-4">
      <AddTag
        existing={tags}
        onAdded={(t) => setTags((prev) => [...prev, t].sort((a, b) => a.name.localeCompare(b.name)))}
        onError={setError}
      />
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="grid grid-cols-[1fr_180px_120px_70px_36px] items-center gap-3 border-b border-line bg-canvas px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          <span>Name</span>
          <span>Preview</span>
          <span>Color</span>
          <span>Leads</span>
          <span></span>
        </div>
        {tags.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12.5px] text-txt-3">
            No tags yet. Add one above, or create them inline from the lead drawer.
          </div>
        ) : (
          tags.map((t) => (
            <div
              key={t.id}
              className="grid grid-cols-[1fr_180px_120px_70px_36px] items-center gap-3 border-b border-line/60 px-3 py-2.5 last:border-b-0"
            >
              <input
                type="text"
                defaultValue={t.name}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (v && v !== t.name) rename(t.id, v);
                  else if (!v) e.currentTarget.value = t.name;
                }}
                className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-[12.5px] hover:border-line focus:border-teal/60 focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-teal/20"
              />
              <span className="flex">
                <TagChip name={t.name} color={t.color} />
              </span>
              <select
                value={t.color}
                onChange={(e) => changeColor(t.id, e.target.value as TagColor)}
                className="rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
              >
                {TAG_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="font-mono text-[11.5px] text-txt-2">{t.leadCount}</span>
              <button
                type="button"
                onClick={() => remove(t)}
                aria-label={`Delete ${t.name}`}
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

function AddTag({
  existing,
  onAdded,
  onError,
}: {
  existing: TagWithCount[];
  onAdded: (t: TagWithCount) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<TagColor>('slate');
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existing.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      onError(`Tag "${trimmed}" already exists.`);
      return;
    }
    setSaving(true);
    startTransition(async () => {
      const res = await getOrCreateTag(trimmed, color);
      setSaving(false);
      if (!res.ok) {
        onError(res.error);
        return;
      }
      if (res.created) {
        onAdded({ ...res.tag, leadCount: 0 });
      }
      setName('');
      setColor('slate');
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
        placeholder="New tag name"
        className="flex-1 min-w-[200px] rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      />
      <select
        value={color}
        onChange={(e) => setColor(e.target.value as TagColor)}
        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      >
        {TAG_COLORS.map((c) => (
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
        {saving ? 'Adding…' : 'Add tag'}
      </button>
    </div>
  );
}
