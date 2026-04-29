'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  getLeadDetail,
  logCall,
  setLeadConsent,
  updateLeadNotes,
  type CallDirection,
  type CallDisposition,
} from '@/app/actions/leads';
import type { LeadDetail, LeadStage, TimelineEntry } from '@/lib/leads';
import { LeadTasksPanel } from '@/components/tasks/lead-tasks-panel';
import { LeadTagsSection } from '@/components/tags/lead-tags-section';
import { LeadScriptsSection } from '@/components/scripts/lead-scripts-section';

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
  const [logOpen, setLogOpen] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();

  async function refreshDetail(id: string) {
    const res = await getLeadDetail(id);
    if (res) setData(res);
  }

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

  function callLead() {
    if (!data?.lead.phone) return;
    const params = new URLSearchParams({ to: data.lead.phone, leadId: data.lead.id });
    router.push(`/dialer?${params.toString()}`);
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
          {lead?.phone && (
            <button
              type="button"
              onClick={callLead}
              className="inline-flex items-center gap-1.5 rounded-lg bg-teal/10 px-2.5 py-1 text-[11.5px] font-medium text-teal hover:bg-teal/15"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57a1 1 0 00-1.02.24l-2.2 2.2a15.05 15.05 0 01-6.59-6.59l2.2-2.2a1 1 0 00.25-1.02A11.36 11.36 0 018.5 4a1 1 0 00-1-1H4a1 1 0 00-1 1c0 9.39 7.61 17 17 17a1 1 0 001-1v-3.5a1 1 0 00-1-1z" />
              </svg>
              Call
            </button>
          )}
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
              <LeadTagsSection leadId={lead.id} />
            </section>

            <section className="border-b border-line p-5">
              <LeadScriptsSection
                lead={{
                  firstName: lead.firstName,
                  lastName: lead.lastName,
                  phone: lead.phone,
                  email: lead.email,
                  stageName: lead.stageId
                    ? stages.find((s) => s.id === lead.stageId)?.name ?? null
                    : null,
                }}
              />
            </section>

            <section className="border-b border-line p-5">
              <LeadTasksPanel leadId={lead.id} />
            </section>

            <section className="border-b border-line p-5">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-txt-3">
                  Call log
                </h4>
                <button
                  type="button"
                  onClick={() => setLogOpen((v) => !v)}
                  className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-txt-2 hover:bg-surface-2"
                >
                  {logOpen ? 'Cancel' : 'Log call'}
                </button>
              </div>
              {logOpen && (
                <LogCallForm
                  leadId={lead.id}
                  onCancel={() => setLogOpen(false)}
                  onLogged={async () => {
                    setLogOpen(false);
                    await refreshDetail(lead.id);
                  }}
                />
              )}
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

const DISPOSITION_OPTIONS: { value: CallDisposition; label: string }[] = [
  { value: 'connected', label: 'Connected' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'failed', label: 'Failed' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'do_not_call', label: 'DNC' },
  { value: 'callback', label: 'Callback' },
  { value: 'sale', label: 'Sale' },
  { value: 'not_interested', label: 'Not interested' },
];

function LogCallForm({
  leadId,
  onCancel,
  onLogged,
}: {
  leadId: string;
  onCancel: () => void;
  onLogged: () => void | Promise<void>;
}) {
  const [direction, setDirection] = useState<CallDirection>('outbound');
  const [disposition, setDisposition] = useState<CallDisposition>('connected');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [callNotes, setCallNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const m = minutes === '' ? 0 : Number(minutes);
    const s = seconds === '' ? 0 : Number(seconds);
    if (Number.isNaN(m) || Number.isNaN(s) || m < 0 || s < 0) {
      setError('Duration must be a positive number.');
      return;
    }
    const total = m * 60 + s;
    setSaving(true);
    const res = await logCall({
      leadId,
      direction,
      disposition,
      durationSec: total > 0 ? total : null,
      notes: callNotes.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await onLogged();
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-canvas p-3">
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          Direction
        </div>
        <div className="flex gap-1.5">
          {(['outbound', 'inbound'] as CallDirection[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`flex-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium capitalize ${
                direction === d
                  ? 'border-teal/60 bg-teal/10 text-teal'
                  : 'border-line text-txt-2 hover:bg-surface-2'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          Disposition
        </div>
        <select
          value={disposition}
          onChange={(e) => setDisposition(e.target.value as CallDisposition)}
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        >
          {DISPOSITION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          Duration
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="0"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            className="w-16 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-center font-mono text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <span className="text-[11.5px] text-txt-3">min</span>
          <input
            type="number"
            min={0}
            max={59}
            inputMode="numeric"
            placeholder="0"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            className="w-16 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-center font-mono text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <span className="text-[11.5px] text-txt-3">sec</span>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          Notes <span className="text-txt-3 normal-case">(optional)</span>
        </div>
        <textarea
          value={callNotes}
          onChange={(e) => setCallNotes(e.target.value)}
          rows={3}
          placeholder="What was discussed?"
          className="w-full resize-none rounded-lg border border-line bg-surface p-2.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        />
      </div>
      {error && <div className="text-[11.5px] text-hp">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-surface-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save call'}
        </button>
      </div>
    </div>
  );
}
