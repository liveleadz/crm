'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteList, renameList } from '@/app/actions/lists';
import type { LeadList } from '@/lib/lists';

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
        href="/leads"
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
                  href={`/leads?list=${l.id}`}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    beginRename(l);
                  }}
                  className={`rounded-full px-3 py-1 text-[11.5px] font-medium ${
                    isActive
                      ? 'bg-teal/15 text-teal'
                      : 'bg-canvas text-txt-2 hover:bg-canvas/70'
                  }`}
                  title="Double-click to rename"
                >
                  {l.name}
                  <span className={`ml-1.5 text-[10.5px] ${isActive ? 'text-teal/70' : 'text-txt-3'}`}>
                    {l.count}
                  </span>
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
    </div>
  );
}
