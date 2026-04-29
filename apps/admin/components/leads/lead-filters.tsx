'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import type { Tag } from '@/lib/tags';
import { TagChip } from '@/components/tags/tag-chip';

const SOURCES = [
  { value: '', label: 'Any source' },
  { value: 'manual', label: 'Manual' },
  { value: 'csv', label: 'CSV' },
  { value: 'form', label: 'Form' },
  { value: 'api', label: 'API' },
  { value: 'workflow', label: 'Workflow' },
];

// Filter bar above the kanban. Mutates the URL search params via router.replace
// so server components re-render with the new filter set. Search input is
// debounced; toggles + selects update immediately.
export function LeadFilters({
  tagLibrary,
  initialSearch,
  initialSource,
  initialTagIds,
  initialDnc,
  initialDne,
}: {
  tagLibrary: Tag[];
  initialSearch: string;
  initialSource: string;
  initialTagIds: string[];
  initialDnc: boolean;
  initialDne: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(initialSearch);
  const [source, setSource] = useState(initialSource);
  const [tagIds, setTagIds] = useState<string[]>(initialTagIds);
  const [dnc, setDnc] = useState(initialDnc);
  const [dne, setDne] = useState(initialDne);
  const [tagOpen, setTagOpen] = useState(false);
  const [, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tagById = useMemo(() => new Map(tagLibrary.map((t) => [t.id, t])), [tagLibrary]);

  function navigate(next: {
    q: string;
    source: string;
    tagIds: string[];
    dnc: boolean;
    dne: boolean;
  }) {
    const sp = new URLSearchParams(params.toString());
    if (next.q) sp.set('q', next.q);
    else sp.delete('q');
    if (next.source) sp.set('source', next.source);
    else sp.delete('source');
    if (next.tagIds.length > 0) sp.set('tags', next.tagIds.join(','));
    else sp.delete('tags');
    if (next.dnc) sp.set('dnc', '1');
    else sp.delete('dnc');
    if (next.dne) sp.set('dne', '1');
    else sp.delete('dne');
    const qs = sp.toString();
    startTransition(() => {
      router.replace((qs ? `${pathname}?${qs}` : pathname) as Route);
    });
  }

  // Debounced URL sync for the search input.
  useEffect(() => {
    if (search === initialSearch) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      navigate({ q: search, source, tagIds, dnc, dne });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function changeSource(v: string) {
    setSource(v);
    navigate({ q: search, source: v, tagIds, dnc, dne });
  }
  function toggleDnc() {
    const v = !dnc;
    setDnc(v);
    navigate({ q: search, source, tagIds, dnc: v, dne });
  }
  function toggleDne() {
    const v = !dne;
    setDne(v);
    navigate({ q: search, source, tagIds, dnc, dne: v });
  }
  function toggleTag(id: string) {
    const v = tagIds.includes(id) ? tagIds.filter((t) => t !== id) : [...tagIds, id];
    setTagIds(v);
    navigate({ q: search, source, tagIds: v, dnc, dne });
  }
  function clearAll() {
    setSearch('');
    setSource('');
    setTagIds([]);
    setDnc(false);
    setDne(false);
    navigate({ q: '', source: '', tagIds: [], dnc: false, dne: false });
  }

  const anyActive = !!search || !!source || tagIds.length > 0 || dnc || dne;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/40 px-4 py-2.5">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-txt-3"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name / phone / email…"
          className="w-[260px] rounded-lg border border-line bg-surface py-1.5 pl-8 pr-2.5 text-[12px] outline-none focus:border-teal/60"
        />
      </div>

      <select
        value={source}
        onChange={(e) => changeSource(e.target.value)}
        className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60"
      >
        {SOURCES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <div className="relative">
        <button
          type="button"
          onClick={() => setTagOpen((v) => !v)}
          onBlur={() => setTimeout(() => setTagOpen(false), 150)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] ${
            tagIds.length > 0
              ? 'border-teal/60 bg-teal/5 text-txt'
              : 'border-line bg-surface text-txt-2'
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" strokeLinejoin="round" />
            <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
          </svg>
          <span>
            Tags{tagIds.length > 0 ? ` · ${tagIds.length}` : ''}
          </span>
        </button>
        {tagOpen && (
          <div
            onMouseDown={(e) => e.preventDefault()}
            className="absolute left-0 top-full z-30 mt-1 max-h-[300px] w-[260px] overflow-auto rounded-lg border border-line bg-surface p-1 shadow-lg"
          >
            {tagLibrary.length === 0 ? (
              <div className="px-2 py-1.5 text-[12px] text-txt-3">No tags yet.</div>
            ) : (
              tagLibrary.map((t) => {
                const on = tagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTag(t.id)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-canvas ${
                      on ? 'bg-canvas' : ''
                    }`}
                  >
                    <span
                      className={`grid h-3.5 w-3.5 place-items-center rounded border ${
                        on ? 'border-teal bg-teal text-white' : 'border-line bg-surface'
                      }`}
                    >
                      {on && (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="m5 12 5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <TagChip name={t.name} color={t.color} />
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {tagIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {tagIds.map((id) => {
            const t = tagById.get(id);
            if (!t) return null;
            return <TagChip key={id} name={t.name} color={t.color} onRemove={() => toggleTag(id)} />;
          })}
        </div>
      )}

      <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-txt-2">
        <input
          type="checkbox"
          checked={dnc}
          onChange={toggleDnc}
          className="h-3.5 w-3.5 accent-teal"
        />
        Hide DNC
      </label>
      <label className="flex cursor-pointer select-none items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-txt-2">
        <input
          type="checkbox"
          checked={dne}
          onChange={toggleDne}
          className="h-3.5 w-3.5 accent-teal"
        />
        Hide DNE
      </label>

      {anyActive && (
        <button
          type="button"
          onClick={clearAll}
          className="ml-auto text-[11.5px] font-medium text-txt-3 hover:text-txt"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
