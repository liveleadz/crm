'use client';

// Flat list view of every lead. Click a row to open the existing
// LeadDetailDrawer (timeline + notes + tags + tasks + scripts already
// built). Quick actions on each row: call (opens /dialer with prefill),
// SMS (opens /messages with prefill).
//
// Bulk operations: per-row checkboxes + sticky action bar reveal modals
// for stage move, tag add, DNC/DNE flagging, and delete. Mirrors the
// pattern shipped on /calls (bulk re-disposition).

import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { LeadCard, LeadStage } from '@/lib/leads';
import type { Tag } from '@/lib/tags';
import {
  bulkAddTagToLeads,
  bulkAssignLeadsOwner,
  bulkDeleteLeads,
  bulkMoveLeadsStage,
  bulkRemoveTagFromLeads,
  bulkSetLeadsConsent,
} from '@/app/actions/leads';
import { LeadDetailDrawer } from './lead-detail-drawer';

export type TeamOpt = { id: string; name: string };

type Props = {
  leads: LeadCard[];
  stages: LeadStage[];
  // Pre-built id -> stage map so we don't rebuild on every render.
  stageById: Record<string, LeadStage>;
  tagLibrary: Tag[];
  team: TeamOpt[];
};

type BulkMode =
  | 'stage'
  | 'tag-add'
  | 'tag-remove'
  | 'consent'
  | 'owner'
  | 'delete'
  | null;

export function LeadsTable({ leads, stages, stageById, tagLibrary, team }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Any link in the app that points at `/leads/{id}` is rewritten by
  // `app/(app)/leads/[id]/page.tsx` to `/leads?lead={id}`. We pick that
  // up here and pop the LeadDetailDrawer open so call-popup Message
  // buttons, Live Floor active-call cards, task rows, etc. all land
  // on the same drawer experience without a 404.
  const leadParam = searchParams.get('lead');
  const [openLeadId, setOpenLeadId] = useState<string | null>(leadParam);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<BulkMode>(null);

  // Sync open drawer when the `lead` query param changes (e.g. user
  // navigates from one lead link to another without a full page refresh).
  useEffect(() => {
    if (leadParam) setOpenLeadId(leadParam);
  }, [leadParam]);

  function closeDrawer() {
    setOpenLeadId(null);
    if (leadParam) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete('lead');
      const qs = next.toString();
      // `replace` so the back button doesn't pogo between open/closed
      // drawer states.
      router.replace(qs ? `/leads?${qs}` : '/leads');
    }
  }

  const allIds = useMemo(() => leads.map((l) => l.id), [leads]);
  const allSelected = selected.size > 0 && selected.size === allIds.length;
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }
  function toggleOne(id: string) {
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
  function onBulkDone() {
    clearSelection();
    setBulkMode(null);
    router.refresh();
  }

  if (leads.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-12">
        <div className="max-w-md rounded-lg border border-dashed border-line-2 bg-surface p-8 text-center">
          <p className="text-[12.5px] text-txt-3">No leads match these filters.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-line bg-teal/10 px-6 py-2">
          <span className="text-[12px] font-medium text-teal">
            {selected.size} selected
          </span>
          <span className="mx-1 h-3 w-px bg-teal/30" />
          <button
            type="button"
            onClick={() => setBulkMode('stage')}
            className="rounded-md border border-teal/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15"
          >
            Move stage
          </button>
          <button
            type="button"
            onClick={() => setBulkMode('tag-add')}
            disabled={tagLibrary.length === 0}
            className="rounded-md border border-teal/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15 disabled:cursor-not-allowed disabled:opacity-50"
            title={tagLibrary.length === 0 ? 'No tags exist for this brand' : ''}
          >
            Add tag
          </button>
          <button
            type="button"
            onClick={() => setBulkMode('tag-remove')}
            disabled={tagLibrary.length === 0}
            className="rounded-md border border-teal/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Remove tag
          </button>
          <button
            type="button"
            onClick={() => setBulkMode('owner')}
            disabled={team.length === 0}
            className="rounded-md border border-teal/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Assign owner
          </button>
          <button
            type="button"
            onClick={() => setBulkMode('consent')}
            className="rounded-md border border-teal/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15"
          >
            Mark DNC / DNE
          </button>
          <button
            type="button"
            onClick={() => setBulkMode('delete')}
            className="rounded-md border border-hp/40 bg-surface px-2.5 py-1 text-[11.5px] font-medium text-hp hover:bg-hp/15"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto rounded-md px-2 py-1 text-[11.5px] text-txt-3 hover:text-txt-1"
          >
            Clear
          </button>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 z-10 border-b border-line bg-canvas text-left">
            <tr className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              <th className="w-9 pl-6 pr-2 py-2.5">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 cursor-pointer accent-teal"
                />
              </th>
              <th className="px-3 py-2.5">Name</th>
              <th className="px-3 py-2.5">Stage</th>
              <th className="px-3 py-2.5">Phone</th>
              <th className="px-3 py-2.5">Email</th>
              <th className="px-3 py-2.5">Source</th>
              <th className="px-3 py-2.5">Tags</th>
              <th className="px-3 py-2.5">Updated</th>
              <th className="px-6 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const stage = lead.stageId ? stageById[lead.stageId] : null;
              const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
              // Prefer person name; fall back to company name from
              // imports (CSVs that only have a business + phone), then a
              // generic placeholder so the row never reads as blank.
              const display = fullName || lead.companyName || 'Unnamed lead';
              const subline = fullName && lead.companyName ? lead.companyName : null;
              const isChecked = selected.has(lead.id);
              return (
                <tr
                  key={lead.id}
                  onClick={() => setOpenLeadId(lead.id)}
                  className={`cursor-pointer border-b border-line/60 transition-colors hover:bg-surface ${
                    isChecked ? 'bg-teal/5' : ''
                  }`}
                >
                  <td
                    className="w-9 pl-6 pr-2 py-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${display}`}
                      checked={isChecked}
                      onChange={() => toggleOne(lead.id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-teal"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-txt-1">{display}</div>
                    {subline && (
                      <div className="mt-0.5 truncate text-[11px] text-txt-3">
                        {subline}
                      </div>
                    )}
                    {(lead.doNotCall || lead.doNotEmail) && (
                      <div className="mt-0.5 flex gap-1">
                        {lead.doNotCall && (
                          <span className="inline-flex h-[16px] items-center rounded-full bg-hp/15 px-1.5 text-[10px] font-medium text-hp">
                            DNC
                          </span>
                        )}
                        {lead.doNotEmail && (
                          <span className="inline-flex h-[16px] items-center rounded-full bg-hp/15 px-1.5 text-[10px] font-medium text-hp">
                            DNE
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {stage ? (
                      <span
                        className="inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium ring-1 ring-line"
                        style={
                          stage.color
                            ? { backgroundColor: `${stage.color}26`, color: stage.color }
                            : undefined
                        }
                      >
                        {stage.name}
                      </span>
                    ) : (
                      <span className="text-txt-3">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11.5px] text-txt-2">
                    {lead.phone || '—'}
                  </td>
                  <td className="px-3 py-2.5 truncate text-txt-2">{lead.email || '—'}</td>
                  <td className="px-3 py-2.5 text-txt-3">{lead.source || '—'}</td>
                  <td className="px-3 py-2.5">
                    {lead.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {lead.tags.slice(0, 3).map((t) => (
                          <span
                            key={t.id}
                            className="inline-flex h-[16px] items-center rounded-full bg-canvas px-1.5 text-[10px] text-txt-2 ring-1 ring-line"
                          >
                            {t.name}
                          </span>
                        ))}
                        {lead.tags.length > 3 && (
                          <span className="text-[10px] text-txt-3">
                            +{lead.tags.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-txt-3">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-txt-3">
                    {timeAgo(lead.updatedAt)}
                  </td>
                  <td
                    className="px-6 py-2.5 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex items-center gap-1">
                      {lead.phone && !lead.doNotCall && (
                        <Link
                          href={`/dialer?to=${encodeURIComponent(lead.phone)}&leadId=${lead.id}`}
                          className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-canvas hover:text-teal"
                          title="Call"
                          aria-label="Call"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                          </svg>
                        </Link>
                      )}
                      {lead.phone && !lead.doNotCall && (
                        <Link
                          href={`/messages?to=${encodeURIComponent(lead.phone)}&leadId=${lead.id}`}
                          className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-canvas hover:text-teal"
                          title="Send SMS"
                          aria-label="Send SMS"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                          </svg>
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <LeadDetailDrawer
        leadId={openLeadId}
        stages={stages}
        team={team}
        onClose={closeDrawer}
      />
      {bulkMode && (
        <BulkLeadsModal
          mode={bulkMode}
          ids={Array.from(selected)}
          stages={stages}
          tagLibrary={tagLibrary}
          team={team}
          onClose={() => setBulkMode(null)}
          onDone={onBulkDone}
        />
      )}
    </>
  );
}

// Single dialog component switches its body based on `mode`. Each branch
// drives the corresponding bulk server action and closes on success.
function BulkLeadsModal({
  mode,
  ids,
  stages,
  tagLibrary,
  team,
  onClose,
  onDone,
}: {
  mode: Exclude<BulkMode, null>;
  ids: string[];
  stages: LeadStage[];
  tagLibrary: Tag[];
  team: TeamOpt[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string>(stages[0]?.id ?? '');
  const [tagId, setTagId] = useState<string>(tagLibrary[0]?.id ?? '');
  // Owner picker: empty string means "Unassigned" (null on the server).
  const [ownerId, setOwnerId] = useState<string>(team[0]?.id ?? '');
  const [doNotCall, setDoNotCall] = useState(true);
  const [doNotEmail, setDoNotEmail] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  function run() {
    setError(null);
    startTransition(async () => {
      let res: { ok: true; count: number } | { ok: false; error: string };
      if (mode === 'stage') {
        if (!stageId) {
          setError('Pick a stage first.');
          return;
        }
        res = await bulkMoveLeadsStage({ ids, stageId });
      } else if (mode === 'tag-add') {
        if (!tagId) {
          setError('Pick a tag first.');
          return;
        }
        res = await bulkAddTagToLeads({ ids, tagId });
      } else if (mode === 'tag-remove') {
        if (!tagId) {
          setError('Pick a tag first.');
          return;
        }
        res = await bulkRemoveTagFromLeads({ ids, tagId });
      } else if (mode === 'owner') {
        res = await bulkAssignLeadsOwner({
          ids,
          ownerId: ownerId === '' ? null : ownerId,
        });
      } else if (mode === 'consent') {
        if (!doNotCall && !doNotEmail) {
          setError('Pick at least one flag to set.');
          return;
        }
        res = await bulkSetLeadsConsent({
          ids,
          doNotCall: doNotCall ? true : undefined,
          doNotEmail: doNotEmail ? true : undefined,
        });
      } else {
        // delete
        if (confirmText.trim().toLowerCase() !== 'delete') {
          setError('Type "delete" to confirm.');
          return;
        }
        res = await bulkDeleteLeads({ ids });
      }
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  const noun = `${ids.length} lead${ids.length === 1 ? '' : 's'}`;
  const title =
    mode === 'stage'
      ? `Move ${noun} to stage`
      : mode === 'tag-add'
        ? `Add tag to ${noun}`
        : mode === 'tag-remove'
          ? `Remove tag from ${noun}`
          : mode === 'owner'
            ? `Assign owner to ${noun}`
            : mode === 'consent'
              ? `Set consent flags on ${noun}`
              : `Delete ${noun}`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-[14px] font-semibold text-txt-1">{title}</div>

        {mode === 'stage' && (
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-teal/60"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}

        {(mode === 'tag-add' || mode === 'tag-remove') && (
          <select
            value={tagId}
            onChange={(e) => setTagId(e.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-teal/60"
          >
            {tagLibrary.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}

        {mode === 'owner' && (
          <select
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-teal/60"
          >
            <option value="">— Unassigned —</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}

        {mode === 'consent' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-[13px] text-txt-2">
              <input
                type="checkbox"
                checked={doNotCall}
                onChange={(e) => setDoNotCall(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal"
              />
              Mark Do Not Call
            </label>
            <label className="flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-2 text-[13px] text-txt-2">
              <input
                type="checkbox"
                checked={doNotEmail}
                onChange={(e) => setDoNotEmail(e.target.checked)}
                className="h-3.5 w-3.5 accent-teal"
              />
              Mark Do Not Email
            </label>
            <p className="text-[11.5px] text-txt-3">
              Flags are added — existing settings on other flags are preserved.
            </p>
          </div>
        )}

        {mode === 'delete' && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-txt-2">
              This permanently removes the selected leads and all their related
              records. Type <span className="font-mono font-semibold">delete</span> to
              confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="delete"
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[13px] outline-none focus:border-hp/60"
            />
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
            {error}
          </div>
        )}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={run}
            disabled={pending}
            className={`flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50 ${
              mode === 'delete' ? 'bg-hp hover:bg-hp/90' : 'bg-teal hover:bg-teal/90'
            }`}
          >
            {pending ? 'Working…' : mode === 'delete' ? 'Delete leads' : 'Apply'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-line px-3 py-2 text-[13px] text-txt-2 hover:bg-canvas"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}
