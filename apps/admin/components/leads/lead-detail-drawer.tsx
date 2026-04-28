'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  getLeadDetail,
  setLeadConsent,
  updateLeadNotes,
} from '@/app/actions/leads';
import type { LeadDetail, LeadStage, TimelineEntry } from '@/lib/leads';

const DISPOSITION_LABEL: Record<string, string> = {
  connected: 'Connected',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  wrong_number: 'Wrong number',
  do_not_call: 'DNC',
  callback: 'Callback',
  sale: 'Sale',
  not_interested: 'Not interested',
};

const APPT_TONE: Record<string, string> = {
  confirmed: 'bg-ll/15 text-ll',
  scheduled: 'bg-bs/15 text-bs',
  pending: 'bg-bi/15 text-bi',
  rescheduled: 'bg-hb/15 text-hb',
  no_show: 'bg-hp/15 text-hp',
  cancelled: 'bg-txt-3/15 text-txt-3',
};

function fullName(l: LeadDetail) {
  const n = [l.firstName, l.lastName].filter(Boolean).join(' ').trim();
  return n || 'Unnamed lead';
}

function initials(l: LeadDetail) {
  const f = l.firstName?.[0] ?? '';
  const last = l.lastName?.[0] ?? '';
  return (f + last).toUpperCase() || '··';
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDuration(seconds: number | null) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function locationLine(l: LeadDetail) {
  const parts = [l.city, l.state, l.zip].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export function LeadDetailDrawer({
  leadId,
  stages,
  onClose,
}: {
  leadId: string | null;
  stages: LeadStage[];
  onClose: () => void;
}) {
  const [data, setData] = useState<{ lead: LeadDetail; timeline: TimelineEntry[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!leadId) {
      setData(null);
      return;
    }
    setLoading(true);
    getLeadDetail(leadId).then((res) => {
      setLoading(false);
      if (res) {
        setData(res);
        setNotes(res.lead.notes ?? '');
      }
    });
  }, [leadId]);

  // Esc to close
  useEffect(() => {
    if (!leadId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leadId, onClose]);

  if (!leadId) return null;

  function saveNotes() {
    if (!data) return;
    if ((data.lead.notes ?? '') === notes) return;
    setSavingNotes(true);
    startTransition(async () => {
      await updateLeadNotes(data.lead.id, notes);
      setData((prev) => (prev ? { ...prev, lead: { ...prev.lead, notes } } : prev));
      setSavingNotes(false);
    });
  }

  function toggleConsent(key: 'doNotCall' | 'doNotEmail') {
    if (!data) return;
    const next = !data.lead[key];
    setData((prev) => (prev ? { ...prev, lead: { ...prev.lead, [key]: next } } : prev));
    startTransition(async () => {
      const res = await setLeadConsent(data.lead.id, { [key]: next });
      if (!res.ok) {
        // Revert
        setData((prev) =>
          prev ? { ...prev, lead: { ...prev.lead, [key]: !next } } : prev,
        );
      }
    });
  }

  const lead = data?.lead;
  const stageName = lead?.stageId
    ? stages.find((s) => s.id === lead.stageId)?.name ?? '—'
    : '—';

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
      />
      <aside
        role="dialog"
        aria-label="Lead detail"
        className="fixed right-0 top-0 z-50 flex h-screen w-[480px] flex-col border-l border-line bg-surface shadow-2xl"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-teal/15 text-[12px] font-semibold text-teal">
            {lead ? initials(lead) : '··'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">
              {lead ? fullName(lead) : loading ? 'Loading…' : 'Lead'}
            </div>
            <div className="truncate font-mono text-[11.5px] text-txt-3">
              {lead?.phone ?? '—'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-txt-3 hover:bg-surface-2"
            aria-label="Close drawer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {!lead ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-txt-3">
            {loading ? 'Loading…' : 'Lead not found.'}
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <section className="border-b border-line p-5">
              <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-txt-3">
                Details
              </h4>
              <dl className="grid grid-cols-[88px_1fr] gap-y-2 text-[12.5px]">
                <dt className="text-txt-3">Stage</dt>
                <dd className="font-medium">{stageName}</dd>
                <dt className="text-txt-3">Source</dt>
                <dd className="capitalize">{lead.source.replace('_', ' ')}</dd>
                <dt className="text-txt-3">Email</dt>
                <dd className="truncate">{lead.email ?? '—'}</dd>
                <dt className="text-txt-3">Location</dt>
                <dd>{locationLine(lead)}</dd>
                <dt className="text-txt-3">Created</dt>
                <dd className="text-txt-2">{formatDateTime(lead.createdAt)}</dd>
              </dl>
            </section>

            <section className="border-b border-line p-5">
              <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-txt-3">
                Consent
              </h4>
              <div className="space-y-2">
                <label className="flex items-center gap-3 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={lead.doNotCall}
                    onChange={() => toggleConsent('doNotCall')}
                    className="h-4 w-4 rounded border-line accent-hp"
                  />
                  <span>
                    Do not call <span className="text-txt-3">(suppresses dialer)</span>
                  </span>
                </label>
                <label className="flex items-center gap-3 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={lead.doNotEmail}
                    onChange={() => toggleConsent('doNotEmail')}
                    className="h-4 w-4 rounded border-line accent-hp"
                  />
                  <span>Do not email</span>
                </label>
              </div>
            </section>

            <section className="border-b border-line p-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-txt-3">
                  Notes
                </h4>
                <span className="text-[10.5px] text-txt-3">
                  {savingNotes ? 'Saving…' : 'Saved on blur'}
                </span>
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={saveNotes}
                rows={4}
                placeholder="Add private notes about this lead…"
                className="w-full resize-none rounded-lg border border-line bg-canvas p-3 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
              />
            </section>

            <section className="p-5">
              <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-txt-3">
                Activity
              </h4>
              {data!.timeline.length === 0 ? (
                <p className="text-[12px] text-txt-3">No activity yet.</p>
              ) : (
                <ol className="space-y-3">
                  {data!.timeline.map((t) => (
                    <TimelineRow key={`${t.kind}:${t.id}`} entry={t} />
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </aside>
    </>
  );
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === 'call') {
    const label = entry.disposition
      ? DISPOSITION_LABEL[entry.disposition] ?? entry.disposition
      : '—';
    return (
      <li className="flex gap-3">
        <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-teal/15 text-teal">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[12.5px] font-medium">
              Call — {entry.direction === 'inbound' ? 'inbound' : 'outbound'}
            </span>
            <span className="ml-auto text-[11px] text-txt-3">
              {formatDateTime(entry.at)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-txt-3">
            <span>{label}</span>
            <span>·</span>
            <span className="font-mono">{formatDuration(entry.durationSec)}</span>
          </div>
        </div>
      </li>
    );
  }
  if (entry.kind === 'appointment') {
    const tone = APPT_TONE[entry.status] ?? 'bg-txt-3/15 text-txt-3';
    return (
      <li className="flex gap-3">
        <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bs/15 text-bs">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 11h18" strokeLinecap="round" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[12.5px] font-medium">{entry.title}</span>
            <span className="ml-auto text-[11px] text-txt-3">
              {formatDateTime(entry.at)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px]">
            <span
              className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium capitalize ${tone}`}
            >
              {entry.status.replace('_', ' ')}
            </span>
            {entry.location && <span className="text-txt-3">· {entry.location}</span>}
          </div>
        </div>
      </li>
    );
  }
  // event
  return (
    <li className="flex gap-3">
      <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-txt-3/15 text-txt-3">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="6" />
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12.5px] font-medium capitalize">
            {entry.type.replace(/_/g, ' ')}
          </span>
          <span className="ml-auto text-[11px] text-txt-3">{formatDateTime(entry.at)}</span>
        </div>
      </div>
    </li>
  );
}
