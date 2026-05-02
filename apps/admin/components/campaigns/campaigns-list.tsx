'use client';

// Index list of campaigns. Manager+ sees a "New campaign" button and every
// campaign in the brand. Agents see only their assigned campaigns and a
// big "Start dialing" CTA on each card.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createCampaign, archiveCampaign } from '@/app/actions/campaigns';
import type { Campaign, CampaignStatus } from '@/lib/campaigns';

const STATUS_DOT: Record<CampaignStatus, string> = {
  active: 'bg-teal',
  paused: 'bg-amber-400',
  archived: 'bg-txt-3/40',
};

type Member = { id: string; fullName: string | null; email: string };

export function CampaignsList({
  initial,
  members,
  canManage,
}: {
  initial: Campaign[];
  members: Member[];
  canManage: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [, startTransition] = useTransition();
  const router = useRouter();

  function memberLabel(id: string): string {
    const m = members.find((x) => x.id === id);
    if (!m) return '?';
    return (m.fullName ?? m.email).split(' ')[0] ?? '?';
  }

  function submitCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    setCreating(true);
    startTransition(async () => {
      const res = await createCampaign({ name: trimmed });
      setCreating(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName('');
      router.push(`/campaigns/${res.data.id}`);
    });
  }

  function archive(id: string, label: string) {
    if (!window.confirm(`Archive "${label}"? Agents will no longer see it.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await archiveCampaign({ id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((c) => c.id !== id));
    });
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate();
            }}
            placeholder="New campaign name (e.g. Q2 Outbound)"
            className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <button
            type="button"
            onClick={submitCreate}
            disabled={creating || !name.trim()}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-2 bg-surface px-6 py-12 text-center">
          <p className="text-[12.5px] text-txt-3">
            {canManage
              ? 'No campaigns yet. Create one above to bundle a script, lead lists, and agents.'
              : 'No campaigns assigned to you yet. Ask a manager to add you.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((c, i) => (
            <div
              key={c.id}
              className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                i < items.length - 1 ? 'border-b border-line/60' : ''
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[c.status]}`} />
              <Link
                href={`/campaigns/${c.id}`}
                className="text-[13px] font-medium hover:underline"
              >
                {c.name}
              </Link>
              <span className="text-[11px] uppercase tracking-wide text-txt-3">{c.status}</span>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-[11.5px] text-txt-3">
                  {c.listIds.length} list{c.listIds.length === 1 ? '' : 's'} ·{' '}
                  {c.agentIds.length} agent{c.agentIds.length === 1 ? '' : 's'}
                </span>
                {c.agentIds.length > 0 && (
                  <div className="flex -space-x-1">
                    {c.agentIds.slice(0, 4).map((id) => (
                      <span
                        key={id}
                        title={memberLabel(id)}
                        className="grid h-6 w-6 place-items-center rounded-full border border-surface bg-canvas text-[10px] font-medium text-txt-2"
                      >
                        {memberLabel(id).slice(0, 1).toUpperCase()}
                      </span>
                    ))}
                    {c.agentIds.length > 4 && (
                      <span className="grid h-6 w-6 place-items-center rounded-full border border-surface bg-canvas text-[9.5px] text-txt-3">
                        +{c.agentIds.length - 4}
                      </span>
                    )}
                  </div>
                )}
                {c.status === 'active' && (
                  <Link
                    href={`/dialer?campaign=${c.id}`}
                    className="rounded-lg bg-teal px-3 py-1 text-[11.5px] font-medium text-white hover:bg-teal/90"
                  >
                    Start dialing
                  </Link>
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => archive(c.id, c.name)}
                    className="rounded-md p-1 text-txt-3 hover:bg-hp/10 hover:text-hp"
                    aria-label="Archive"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
