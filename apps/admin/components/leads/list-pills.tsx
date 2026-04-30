'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { bulkDeleteLists, deleteList, renameList } from '@/app/actions/lists';
import type { LeadList, SmartListCriteria } from '@/lib/lists';

// Build a /leads URL that re-applies a saved smart-list's stored criteria
// via search params. Includes `list=<id>` so the pill can render as active.
function smartListHref(list: LeadList): Route {
  const c: SmartListCriteria = list.criteria ?? {};
  const sp = new URLSearchParams();
  sp.set('list', list.id);
  if (c.search) sp.set('q', c.search);
  if (c.source) sp.set('source', c.source);
  if (c.tagIds && c.tagIds.length > 0) sp.set('tags', c.tagIds.join(','));
  if (c.excludeDnc) sp.set('dnc', '1');
  if (c.excludeDne) sp.set('dne', '1');
  return `/leads?${sp.toString()}` as Route;
}

export function ListPills({
  lists,
  activeListId,
}: {
  lists: LeadList[];
  activeListId: string | null;
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  // Manage mode replaces the rename/delete-on-hover affordance with explicit
  // checkboxes on every pill plus a bulk-delete bar. Click a pill while in
  // manage mode to toggle its selection.
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function exitManage() {
    setManageMode(false);
    setSelected(new Set());
  }
  function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} list${ids.length === 1 ? '' : 's'}? Leads stay; the list tag is removed.`)) return;
    setBusy(true);
    startTransition(async () => {
      const res = await bulkDeleteLists({ ids });
      setBusy(false);
      if (res.ok) {
        if (activeListId && selected.has(activeListId)) router.push('/leads');
        else router.refresh();
        exitManage();
      }
    });
  }

  function beginRename(list: LeadList) {
    setEditingId(list.id);
    setDraftName(list.name);
  }

  function cancelRename() {
    setEditingId(null);
    setDraftName('');
  }

  function commitRename(id: string) {
    const name = draftName.trim();
    if (!name) {
      cancelRename();
      return;
    }
    setBusy(true);
    startTransition(async () => {
      const res = await renameList(id, name);
      setBusy(false);
      if (res.ok) {
        cancelRename();
        router.refresh();
      }
    });
  }

  function handleDelete(list: LeadList) {
    if (
      !confirm(
        `Delete list "${list.name}"? Leads in it stay, but lose their list tag.`,
      )
    ) {
      return;
    }
    setBusy(true);
    startTransition(async () => {
      const res = await deleteList(list.id);
      setBusy(false);
      if (res.ok) {
        if (activeListId === list.id) {
          router.push('/leads');
        } else {
          router.refresh();
        }
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-6 py-2.5">
      <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
        Smart lists
      </span>
      <Link
        href="/pipelines"
        className={`rounded-full px-3 py-1 text-[11.5px] font-medium ${
          activeListId === null
            ? 'bg-teal/15 text-teal'
            : 'bg-canvas text-txt-2 hover:bg-canvas/70'
        }`}
      >
        All leads
      </Link>
      {lists.map((l) => {
        const isActive = activeListId === l.id;
        const isEditing = editingId === l.id;
        const isSelected = selected.has(l.id);
        if (manageMode) {
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => toggleSelected(l.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium ${
                isSelected
                  ? 'bg-teal/15 text-teal ring-2 ring-teal/40'
                  : 'bg-canvas text-txt-2 hover:bg-canvas/70'
              }`}
              title="Click to toggle selection"
            >
              <input
                type="checkbox"
                readOnly
                checked={isSelected}
                className="h-3 w-3 cursor-pointer accent-teal"
              />
              {l.name}
              <span className="text-[10.5px] text-txt-3">{l.count}</span>
            </button>
          );
        }
        return (
          <div key={l.id} className="group relative inline-flex items-center">
            {isEditing ? (
              <div className="flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5">
                <input
                  type="text"
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(l.id);
                    if (e.key === 'Escape') cancelRename();
                  }}
                  onBlur={() => commitRename(l.id)}
                  disabled={busy}
                  className="w-32 rounded-full bg-canvas px-2 py-0.5 text-[11.5px] outline-none focus:ring-1 focus:ring-teal/40"
                />
              </div>
            ) : (
              <>
                <Link
                  href={
                    l.source === 'filter'
                      ? smartListHref(l)
                      : (`/pipelines?list=${l.id}` as Route)
                  }
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    beginRename(l);
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-medium ${
                    isActive
                      ? 'bg-teal/15 text-teal'
                      : 'bg-canvas text-txt-2 hover:bg-canvas/70'
                  }`}
                  title={
                    l.source === 'filter'
                      ? 'Saved filter · double-click to rename'
                      : 'Double-click to rename'
                  }
                >
                  {l.source === 'filter' && (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="opacity-70"
                    >
                      <path d="M3 5h18l-7 9v5l-4-2v-3L3 5Z" strokeLinejoin="round" />
                    </svg>
                  )}
                  {l.name}
                  {l.source !== 'filter' && (
                    <span className={`text-[10.5px] ${isActive ? 'text-teal/70' : 'text-txt-3'}`}>
                      {l.count}
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={() => handleDelete(l)}
                  disabled={busy}
                  className="ml-0.5 hidden h-5 w-5 items-center justify-center rounded-full text-txt-3 hover:bg-hp/10 hover:text-hp group-hover:inline-flex"
                  aria-label={`Delete ${l.name}`}
                  title="Delete list"
                >
                  ×
                </button>
              </>
            )}
          </div>
        );
      })}

      <div className="ml-auto flex items-center gap-1.5">
        {manageMode ? (
          <>
            <span className="text-[11px] text-txt-3">{selected.size} selected</span>
            <button
              type="button"
              onClick={bulkDelete}
              disabled={busy || selected.size === 0}
              className="rounded-md border border-hp/40 bg-hp/10 px-2 py-0.5 text-[11px] text-hp hover:bg-hp/20 disabled:opacity-40"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={exitManage}
              className="rounded-md px-2 py-0.5 text-[11px] text-txt-3 hover:text-txt-1"
            >
              Done
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setManageMode(true)}
            className="rounded-md border border-line bg-canvas px-2 py-0.5 text-[11px] text-txt-2 hover:bg-canvas/70"
          >
            Manage
          </button>
        )}
      </div>
    </div>
  );
}
