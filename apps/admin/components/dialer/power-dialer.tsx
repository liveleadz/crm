'use client';

// Power dialer — auto-advances through a queue of leads. After every
// call ends and the agent saves a disposition, the next lead is dialed
// automatically. Pause to stop auto-advance; Skip to abandon the
// current call early; End queue to bail entirely.
//
// State machine (per lead):
//   queued → connecting → in_call → wrap_up → (auto-advance)
// Plus paused / done overlays.

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { SignalWire, type SignalWireClient, type FabricRoomSession } from '@signalwire/js';
import {
  attachSignalwireCallId,
  bookAppointmentFromCall,
  markCallEnded,
  prepareCall,
} from '@/app/actions/dialer';
import {
  DispositionPicker,
  type DispositionChoice,
} from '@/components/dialer/disposition-picker';
import { RecordingButton } from '@/components/calls/recording-button';
import { LeadContextPanel } from '@/components/dialer/lead-context-panel';
import type { QueuedLead } from '@/lib/dial-queue';
import type { ScriptRow } from '@/lib/campaigns';

type Status =
  | { kind: 'idle' } // queue not started yet
  | { kind: 'paused' }
  | { kind: 'connecting' }
  | { kind: 'in_call'; startedAt: number }
  | { kind: 'wrap_up'; callId: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

type Outcome = {
  leadId: string;
  // Set when prepareCall succeeded — used to fetch the recording from the
  // Done sidebar once SignalWire finalizes the upload (a few seconds
  // after hangup). Null on error/skip-before-prepare paths.
  callId: string | null;
  disposition: string | null; // null = skipped
};

export function PowerDialer({
  brandName,
  fromE164,
  dispositions,
  queue,
  campaignId = null,
  script = null,
}: {
  brandName: string | null;
  fromE164: string | null;
  dispositions: DispositionChoice[];
  queue: QueuedLead[];
  // When set, every call is attributed to this campaign and the script
  // panel renders on the right.
  campaignId?: string | null;
  script?: ScriptRow | null;
}) {
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [muted, setMuted] = useState(false);
  const [, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(0);
  const [bookingOpen, setBookingOpen] = useState(false);
  const clientRef = useRef<SignalWireClient | null>(null);
  const sessionRef = useRef<FabricRoomSession | null>(null);
  const callIdRef = useRef<string | null>(null);
  // Latch of the last call id so advance() can stamp it onto the
  // Outcome once we leave wrap_up (callIdRef itself gets cleared in
  // finishCall before the disposition picker fires).
  const lastCallIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);
  // After we save a disposition we want the next dial to happen without
  // an extra click. Tracked here so the disposition-picker callback can
  // peek without retriggering React state.
  const autoAdvanceRef = useRef(true);

  const current = queue[index] ?? null;
  const remaining = Math.max(0, queue.length - index);
  const completed = outcomes.length;

  // Tick the in-call timer.
  useEffect(() => {
    if (status.kind !== 'in_call') {
      setElapsed(0);
      return;
    }
    const t = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - status.startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [status]);

  // Tear down the SignalWire client on unmount.
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        void clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  async function getClient(): Promise<SignalWireClient> {
    if (clientRef.current) return clientRef.current;
    const tokenRes = await fetch('/api/signalwire/token', { method: 'POST' });
    if (!tokenRes.ok) throw new Error('Could not get SignalWire token.');
    const { token } = (await tokenRes.json()) as { token: string };
    const client = await SignalWire({ token });
    clientRef.current = client;
    return client;
  }

  async function dialIndex(i: number) {
    const lead = queue[i];
    if (!lead) {
      setStatus({ kind: 'done' });
      return;
    }
    if (!fromE164) {
      setStatus({ kind: 'error', message: 'No outbound number assigned to this brand.' });
      return;
    }
    setStatus({ kind: 'connecting' });
    try {
      const prep = await prepareCall({ toNumber: lead.phone, leadId: lead.id, campaignId });
      if (!prep.ok) {
        setStatus({ kind: 'error', message: prep.error });
        return;
      }
      callIdRef.current = prep.callId;
      const client = await getClient();
      const session = await client.dial({
        to: prep.fabricAddress,
        audio: true,
        video: false,
        negotiateVideo: false,
        userVariables: { t: prep.dialToken },
      });
      sessionRef.current = session;
      const swCallId = (session as unknown as { id?: string }).id;
      if (swCallId) {
        startTransition(() => {
          void attachSignalwireCallId({ callId: prep.callId, signalwireCallId: swCallId });
        });
      }
      session.on?.('destroy', () => {
        finishCall();
      });
      await session.start();
      const startedAt = Date.now();
      startedAtRef.current = startedAt;
      setStatus({ kind: 'in_call', startedAt });
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message ?? 'Call failed.' });
    }
  }

  function finishCall() {
    const cid = callIdRef.current;
    const startedAt = startedAtRef.current;
    sessionRef.current = null;
    callIdRef.current = null;
    lastCallIdRef.current = cid;
    startedAtRef.current = null;
    setMuted(false);
    if (cid) {
      const duration = startedAt
        ? Math.floor((Date.now() - startedAt) / 1000)
        : undefined;
      startTransition(() => {
        void markCallEnded({ callId: cid, durationSec: duration });
      });
      // Disposition gate before we advance.
      setStatus({ kind: 'wrap_up', callId: cid });
    } else {
      // No call row was created (rare — error before prepareCall returned).
      advance(null);
    }
  }

  function advance(disposition: string | null) {
    if (current) {
      const callId = lastCallIdRef.current;
      lastCallIdRef.current = null;
      setOutcomes((cur) => [...cur, { leadId: current.id, callId, disposition }]);
    }
    const nextIndex = index + 1;
    setIndex(nextIndex);
    if (nextIndex >= queue.length) {
      setStatus({ kind: 'done' });
      return;
    }
    if (autoAdvanceRef.current) {
      // Tiny debounce so the agent sees the "Saved" flash before next dial.
      window.setTimeout(() => void dialIndex(nextIndex), 600);
    } else {
      setStatus({ kind: 'paused' });
    }
  }

  async function hangupCurrent() {
    const s = sessionRef.current;
    if (s) {
      try {
        await s.hangup();
      } catch {
        /* ignore */
      }
    }
    // session destroy listener flips us into wrap_up.
  }

  async function skipNoDisp() {
    // Abandon the active call without setting a disposition.
    await hangupCurrent();
    // finishCall will fire from the destroy listener, putting us into
    // wrap_up; from there, jump straight to advance(null).
  }

  function onDispositionSaved(code: string) {
    // Picker hands us the saved code so the "Done" sidebar can show the
    // actual outcome (e.g. "no_answer") instead of a generic "saved".
    advance(code);
  }

  function startQueue() {
    autoAdvanceRef.current = true;
    void dialIndex(index);
  }

  function pauseQueue() {
    autoAdvanceRef.current = false;
    if (status.kind === 'idle' || status.kind === 'paused') {
      setStatus({ kind: 'paused' });
    }
  }

  function resumeQueue() {
    autoAdvanceRef.current = true;
    if (status.kind === 'paused' && index < queue.length) {
      void dialIndex(index);
    } else if (status.kind === 'wrap_up') {
      // No-op — disposition picker will fire onDispositionSaved which
      // calls advance() which will dial because autoAdvance is true.
    }
  }

  function endQueue() {
    autoAdvanceRef.current = false;
    setStatus({ kind: 'done' });
  }

  async function toggleMute() {
    const s = sessionRef.current;
    if (!s) return;
    try {
      if (muted) {
        await s.audioUnmute();
        setMuted(false);
      } else {
        await s.audioMute();
        setMuted(true);
      }
    } catch {
      /* ignore */
    }
  }

  // Keyboard shortcuts. Suspended while the disposition note/textarea
  // is focused so typing notes doesn't accidentally hang up the call.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt) {
        const tag = tgt.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tgt.isContentEditable) return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        endQueue();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (status.kind === 'idle') startQueue();
        else if (status.kind === 'paused') resumeQueue();
        else if (status.kind === 'in_call' || status.kind === 'connecting') pauseQueue();
        return;
      }
      if (status.kind !== 'in_call') return;
      const k = e.key.toLowerCase();
      if (k === 'm') {
        e.preventDefault();
        void toggleMute();
      } else if (k === 'h') {
        e.preventDefault();
        void hangupCurrent();
      } else if (k === 's') {
        e.preventDefault();
        void skipNoDisp();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind]);

  const dispMeta = useMemo(() => {
    const m = new Map<string, DispositionChoice>();
    for (const c of dispositions) m.set(c.code, c);
    return m;
  }, [dispositions]);

  const headline = useMemo(() => {
    if (queue.length === 0) return 'No leads queued';
    if (status.kind === 'done') return 'Queue complete';
    if (!current) return 'Queue complete';
    return leadDisplay(current);
  }, [queue.length, status.kind, current]);

  return (
    <div className={`mx-auto w-full ${script ? 'max-w-6xl' : 'max-w-3xl'}`}>
      <div
        className={`grid gap-4 ${
          script
            ? 'lg:grid-cols-[260px_1fr_320px]'
            : 'lg:grid-cols-[1fr_280px]'
        }`}
      >
        {script && <ScriptPanel script={script} />}
        <div className="rounded-2xl border border-line bg-surface p-5">
          <div className="mb-3 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
            <span>
              Power dialer{brandName ? ` · ${brandName}` : ''}
            </span>
            <span>
              {completed} / {queue.length} ·{' '}
              <span className="text-teal">{remaining} left</span>
            </span>
          </div>

          {queue.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-6 text-center text-[12px] text-txt-3">
              No leads matched the current filter / list. Refine your filters and try
              again.
            </div>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-line bg-canvas p-4">
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
                  {currentLabel(status)}
                </div>
                <div className="mt-1 truncate text-[16px] font-semibold text-txt-1">
                  {headline}
                </div>
                {current && leadSubline(current) && (
                  <div className="mt-0.5 truncate text-[12.5px] text-txt-2">
                    {leadSubline(current)}
                  </div>
                )}
                {current && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-txt-3">
                    <span className="font-mono text-[12px] text-txt-2">{current.phone}</span>
                    {current.email && (
                      <span className="truncate">{current.email}</span>
                    )}
                    {leadLocation(current) && (
                      <span>{leadLocation(current)}</span>
                    )}
                  </div>
                )}
                {status.kind === 'in_call' && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-teal/15 px-2.5 py-1 font-mono text-[11.5px] text-teal">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal" />
                    {formatDur(elapsed)}
                  </div>
                )}
                {status.kind === 'error' && (
                  <div className="mt-3 rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] text-hp">
                    {status.message}
                  </div>
                )}
                {campaignId &&
                  current &&
                  (status.kind === 'in_call' || status.kind === 'wrap_up') && (
                    <button
                      type="button"
                      onClick={() => setBookingOpen(true)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[11.5px] font-medium text-txt-2 hover:border-teal/40 hover:text-teal"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="18" rx="2" />
                        <path d="M16 2v4M8 2v4M3 10h18" />
                      </svg>
                      Book appointment
                    </button>
                  )}
              </div>

              {current &&
                (status.kind === 'in_call' ||
                  status.kind === 'wrap_up' ||
                  status.kind === 'connecting') && (
                  <LeadContextPanel leadId={current.id} />
                )}

              {status.kind === 'wrap_up' ? (
                <DispositionPicker
                  callId={status.callId}
                  choices={dispositions}
                  campaignId={campaignId}
                  onSaved={onDispositionSaved}
                />
              ) : (
                <Controls
                  status={status}
                  fromE164={fromE164}
                  muted={muted}
                  onStart={startQueue}
                  onPause={pauseQueue}
                  onResume={resumeQueue}
                  onSkip={skipNoDisp}
                  onHangup={hangupCurrent}
                  onMute={toggleMute}
                  onEnd={endQueue}
                />
              )}
            </>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface p-3 lg:max-h-[520px] lg:overflow-auto">
          <div className="mb-2 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
            Up next
          </div>
          {queue.slice(index, index + 30).map((l, i) => {
            const sub = leadSubline(l);
            return (
              <div
                key={l.id}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12px] ${
                  i === 0
                    ? 'bg-teal/10 text-teal ring-1 ring-teal/40'
                    : 'text-txt-2 hover:bg-canvas'
                }`}
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    i === 0 ? 'bg-teal' : 'bg-line-2'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{leadDisplay(l)}</div>
                  {sub && (
                    <div
                      className={`truncate text-[10.5px] ${
                        i === 0 ? 'text-teal/80' : 'text-txt-3'
                      }`}
                    >
                      {sub}
                    </div>
                  )}
                </div>
                <span className="ml-2 shrink-0 truncate font-mono text-[10.5px] text-txt-3">
                  {l.phone}
                </span>
              </div>
            );
          })}
          {queue.length > index + 30 && (
            <div className="mt-2 px-1 text-[10.5px] text-txt-3">
              +{queue.length - index - 30} more
            </div>
          )}
          {outcomes.length > 0 && (
            <>
              <div className="mt-3 mb-2 border-t border-line/60 px-1 pt-3 text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
                Done · {outcomes.length}
              </div>
              {outcomes
                .slice(-12)
                .reverse()
                .map((o, idx) => {
                  const lead = queue.find((q) => q.id === o.leadId);
                  const meta = o.disposition ? dispMeta.get(o.disposition) : null;
                  const dotCls =
                    !o.disposition
                      ? 'bg-line-2'
                      : meta?.tone === 'good'
                        ? 'bg-teal'
                        : meta?.tone === 'bad'
                          ? 'bg-hp'
                          : 'bg-txt-3/50';
                  return (
                    <div
                      key={`${o.leadId}-${idx}`}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-txt-3"
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
                      <span className="truncate">
                        {lead ? leadDisplay(lead) : '—'}
                      </span>
                      {o.callId && <RecordingButton callId={o.callId} size="xs" />}
                      <span className="ml-auto text-[10.5px]">
                        {o.disposition ? meta?.label ?? o.disposition : 'skipped'}
                      </span>
                    </div>
                  );
                })}
            </>
          )}
        </div>
      </div>
      {bookingOpen && campaignId && current && (
        <BookAppointmentModal
          campaignId={campaignId}
          callId={callIdRef.current ?? lastCallIdRef.current ?? ''}
          leadId={current.id}
          leadName={leadDisplay(current)}
          onClose={() => setBookingOpen(false)}
        />
      )}
    </div>
  );
}

// Lightweight panel pinned to the left of the dialer in campaign mode.
// Long scripts get a search box so reps can jump to the right beat.
function ScriptPanel({ script }: { script: ScriptRow }) {
  const [query, setQuery] = useState('');
  const body = script.body ?? '';
  // Highlight matches inline by wrapping each occurrence in <mark>. We
  // build a regex from the trimmed query; empty query renders as-is.
  const rendered = useMemo(() => {
    const q = query.trim();
    if (!q) return body;
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return body.replace(new RegExp(safe, 'gi'), (m) => `\u0001${m}\u0002`);
  }, [body, query]);

  return (
    <aside className="rounded-2xl border border-line bg-surface p-3 lg:max-h-[680px] lg:overflow-auto">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
          Script
        </div>
        {script.name && (
          <div className="truncate text-[10.5px] text-txt-3">{script.name}</div>
        )}
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find in script…"
        className="mb-2 w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[12px] outline-none focus:border-teal/60"
      />
      <pre className="whitespace-pre-wrap break-words font-sans text-[12.5px] leading-relaxed text-txt-1">
        {rendered.split('\u0001').map((chunk, i) => {
          if (i === 0) return <span key={i}>{chunk}</span>;
          const [hit, rest = ''] = chunk.split('\u0002');
          return (
            <span key={i}>
              <mark className="rounded bg-teal/20 px-0.5 text-teal">{hit}</mark>
              {rest}
            </span>
          );
        })}
      </pre>
    </aside>
  );
}

// Booking dialog: campaign supplies calendar + default owner, so the rep
// just picks date/time/title. Server validates the rep can book that
// calendar; external push happens best-effort.
function BookAppointmentModal({
  campaignId,
  callId,
  leadId,
  leadName,
  onClose,
}: {
  campaignId: string;
  callId: string;
  leadId: string;
  leadName: string;
  onClose: () => void;
}) {
  const defaultStart = useMemo(() => {
    // Tomorrow 10:00 local — sensible default for "follow-up next day".
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    return toLocalDatetime(d);
  }, []);
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [duration, setDuration] = useState(30);
  const [title, setTitle] = useState(`Follow-up with ${leadName}`);
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit() {
    if (!startsAt) {
      setError('Pick a start time.');
      return;
    }
    setError(null);
    const start = new Date(startsAt);
    const end = new Date(start.getTime() + duration * 60_000);
    startTransition(async () => {
      const res = await bookAppointmentFromCall({
        callId,
        leadId,
        campaignId,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        title,
        notes: notes || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      window.setTimeout(onClose, 900);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-line bg-surface p-5">
        <div className="text-[14px] font-semibold text-txt-1">Book appointment</div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-txt-3">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[14px] outline-none focus:border-teal/60"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-txt-3">
              Start
            </label>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[14px] outline-none focus:border-teal/60"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-txt-3">
              Duration (min)
            </label>
            <input
              type="number"
              min={5}
              step={5}
              value={duration}
              onChange={(e) => setDuration(Math.max(5, Number(e.target.value) || 30))}
              className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[14px] outline-none focus:border-teal/60"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-txt-3">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border border-line bg-canvas px-3 py-2 text-[14px] outline-none focus:border-teal/60"
          />
        </div>
        {error && (
          <div className="rounded-md border border-hp/40 bg-hp/10 px-3 py-2 text-[12.5px] text-hp">
            {error}
          </div>
        )}
        {saved && (
          <div className="rounded-md border border-teal/40 bg-teal/10 px-3 py-2 text-[12.5px] text-teal">
            Appointment booked.
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending || saved}
            className="flex-1 rounded-lg bg-teal py-2 text-[13.5px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {pending ? 'Booking…' : 'Book'}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-line px-3 py-2 text-[13.5px] text-txt-2 hover:bg-canvas"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Format a Date as YYYY-MM-DDTHH:mm in local time for <input type="datetime-local">.
function toLocalDatetime(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Controls({
  status,
  fromE164,
  muted,
  onStart,
  onPause,
  onResume,
  onSkip,
  onHangup,
  onMute,
  onEnd,
}: {
  status: Status;
  fromE164: string | null;
  muted: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  onHangup: () => void;
  onMute: () => void;
  onEnd: () => void;
}) {
  if (status.kind === 'done') {
    return (
      <div className="rounded-xl border border-teal/40 bg-teal/10 p-4 text-center text-[12.5px] text-teal">
        Queue complete.
      </div>
    );
  }
  if (status.kind === 'idle') {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!fromE164}
          onClick={onStart}
          className="flex-1 rounded-xl bg-teal px-3 py-2 text-[13px] font-semibold text-white shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.22)] hover:bg-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start power dial
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="rounded-xl border border-line bg-canvas px-3 py-2 text-[12.5px] text-txt-2 hover:border-hp/40 hover:text-hp"
        >
          Cancel
        </button>
      </div>
    );
  }
  if (status.kind === 'paused') {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onResume}
          className="flex-1 rounded-xl bg-teal px-3 py-2 text-[13px] font-semibold text-white shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.22)] hover:bg-teal/90"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="rounded-xl border border-hp/40 bg-hp/10 px-3 py-2 text-[12.5px] text-hp hover:bg-hp/20"
        >
          End queue
        </button>
      </div>
    );
  }
  if (status.kind === 'connecting') {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPause}
          className="flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-[12.5px] text-txt-2 hover:bg-surface"
        >
          Pause
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="rounded-xl border border-hp/40 bg-hp/10 px-3 py-2 text-[12.5px] text-hp hover:bg-hp/20"
        >
          End queue
        </button>
      </div>
    );
  }
  if (status.kind === 'in_call') {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMute}
          className={`rounded-xl border px-3 py-2 text-[12.5px] font-medium ${
            muted
              ? 'border-hp bg-hp text-white'
              : 'border-line bg-canvas text-txt-2 hover:bg-surface'
          }`}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="rounded-xl border border-line bg-canvas px-3 py-2 text-[12.5px] text-txt-2 hover:border-line-2"
          title="End call without setting a disposition"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={onHangup}
          className="ml-auto rounded-xl border border-hp bg-hp px-3 py-2 text-[12.5px] font-semibold text-white shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.22)] hover:bg-hp/90"
        >
          Hang up
        </button>
      </div>
    );
  }
  return null;
}

// Primary headline for a lead. Prefer a real person name; if neither
// first nor last is present, fall back to the company name; if neither,
// fall back to the phone number so something is always visible.
function leadDisplay(l: QueuedLead): string {
  const n = [l.firstName, l.lastName].filter(Boolean).join(' ').trim();
  if (n) return n;
  if (l.companyName) return l.companyName;
  return l.phone;
}

// Secondary line. If we showed a person name above, show the company
// here; if we showed the company above, suppress (avoid duplicate).
function leadSubline(l: QueuedLead): string | null {
  const hasName = !!(l.firstName || l.lastName);
  if (hasName && l.companyName) return l.companyName;
  return null;
}

function leadLocation(l: QueuedLead): string | null {
  const parts = [l.city, l.state].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(', ') : null;
}

function currentLabel(s: Status): string {
  switch (s.kind) {
    case 'idle':
      return 'Ready';
    case 'paused':
      return 'Paused';
    case 'connecting':
      return 'Calling…';
    case 'in_call':
      return 'On call';
    case 'wrap_up':
      return 'Wrap-up';
    case 'done':
      return 'Done';
    case 'error':
      return 'Error';
    default:
      return '';
  }
}

function formatDur(s: number): string {
  const m = Math.floor(s / 60);
  const r = (s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
}
