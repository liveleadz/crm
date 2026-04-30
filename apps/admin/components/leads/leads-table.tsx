'use client';

// Flat list view of every lead. Click a row to open the existing
// LeadDetailDrawer (timeline + notes + tags + tasks + scripts already
// built). Quick actions on each row: call (opens /dialer with prefill),
// SMS (opens /messages with prefill).

import Link from 'next/link';
import { useState } from 'react';
import type { LeadCard, LeadStage } from '@/lib/leads';
import { LeadDetailDrawer } from './lead-detail-drawer';

type Props = {
  leads: LeadCard[];
  stages: LeadStage[];
  // Pre-built id -> stage map so we don't rebuild on every render.
  stageById: Record<string, LeadStage>;
};

export function LeadsTable({ leads, stages, stageById }: Props) {
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

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
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 z-10 border-b border-line bg-canvas text-left">
            <tr className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              <th className="px-6 py-2.5">Name</th>
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
              const display = fullName || 'Unnamed lead';
              return (
                <tr
                  key={lead.id}
                  onClick={() => setOpenLeadId(lead.id)}
                  className="cursor-pointer border-b border-line/60 transition-colors hover:bg-surface"
                >
                  <td className="px-6 py-2.5">
                    <div className="font-medium text-txt-1">{display}</div>
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
        onClose={() => setOpenLeadId(null)}
      />
    </>
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
