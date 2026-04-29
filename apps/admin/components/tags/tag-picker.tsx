'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  attachTagByName,
  getBrandTags,
  removeTagFromLead,
  addTagToLead,
} from '@/app/actions/tags';
import type { Tag } from '@/lib/tags';
import { TagChip } from './tag-chip';

// Inline lead tag editor. Lists currently attached chips with a removable ×,
// plus a typeahead input that suggests existing brand tags and creates new
// ones on Enter when no match exists.
export function TagPicker({
  leadId,
  initialTags,
  onChange,
}: {
  leadId: string;
  initialTags: Tag[];
  onChange?: (tags: Tag[]) => void;
}) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [library, setLibrary] = useState<Tag[]>([]);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getBrandTags().then(setLibrary);
  }, []);

  useEffect(() => {
    onChange?.(tags);
  }, [tags, onChange]);

  const attachedIds = new Set(tags.map((t) => t.id));
  const lower = draft.trim().toLowerCase();
  const suggestions = library
    .filter(
      (t) =>
        !attachedIds.has(t.id) &&
        (lower === '' || t.name.toLowerCase().includes(lower)),
    )
    .slice(0, 8);
  const hasExactMatch = library.some((t) => t.name.toLowerCase() === lower);
  const showCreate = lower.length > 0 && !hasExactMatch;

  function commit(next: Tag[]) {
    setTags(next);
  }

  function handleAttachExisting(tag: Tag) {
    if (busy) return;
    setBusy(true);
    setDraft('');
    setOpen(false);
    const optimistic = [...tags, tag];
    commit(optimistic);
    startTransition(async () => {
      const r = await addTagToLead(leadId, tag.id);
      if (!r.ok) {
        commit(tags);
      }
      setBusy(false);
      inputRef.current?.focus();
    });
  }

  function handleCreate(name: string) {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setDraft('');
    setOpen(false);
    startTransition(async () => {
      const r = await attachTagByName(leadId, trimmed);
      if (r.ok) {
        const next = [...tags, r.tag];
        commit(next);
        setLibrary((prev) => (prev.some((t) => t.id === r.tag.id) ? prev : [...prev, r.tag]));
      }
      setBusy(false);
      inputRef.current?.focus();
    });
  }

  function handleRemove(tag: Tag) {
    if (busy) return;
    setBusy(true);
    const prev = tags;
    commit(tags.filter((t) => t.id !== tag.id));
    startTransition(async () => {
      const r = await removeTagFromLead(leadId, tag.id);
      if (!r.ok) commit(prev);
      setBusy(false);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions[0] && !showCreate) {
        handleAttachExisting(suggestions[0]);
      } else if (showCreate) {
        handleCreate(draft);
      }
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      handleRemove(tags[tags.length - 1]!);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-canvas px-2 py-1.5 focus-within:border-teal/60"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((t) => (
          <TagChip key={t.id} name={t.name} color={t.color} onRemove={() => handleRemove(t)} />
        ))}
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder={tags.length === 0 ? 'Add tags…' : ''}
          className="min-w-[80px] flex-1 bg-transparent text-[12px] outline-none placeholder:text-txt-3"
        />
      </div>
      {open && (suggestions.length > 0 || showCreate) && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {suggestions.map((t) => (
            <button
              key={t.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAttachExisting(t)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-canvas"
            >
              <TagChip name={t.name} color={t.color} />
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleCreate(draft)}
              className="flex w-full items-center gap-2 border-t border-line px-2.5 py-1.5 text-left text-[12px] text-txt-2 hover:bg-canvas"
            >
              <span className="text-txt-3">+ Create</span>
              <span className="font-medium">"{draft.trim()}"</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
