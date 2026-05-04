'use client';

// Power dialer — auto-advances through a queue of leads. After every
// call ends and the agent saves a disposition, the next lead is dialed
// automatically. Pause to stop auto-advance; Skip to abandon the
// current call early; End queue to bail entirely.
//
// State machine (per lead):
//   queued → connecting → in_call → wrap_up → (auto-advance)
// Plus paused / done overlays.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
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
import {
  entrySectionId,
  nextSectionForDisposition,
  type ScriptSection,
} from '@/lib/scripts';
import { dialWindowCheck, type TcpaPolicy } from '@/lib/tcpa';

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
  sessionKey = null,
  script = null,
  tcpaPolicy = null,
  brandTimezone = 'UTC',
}: {
  brandName: string | null;
  fromE164: string | null;
  dispositions: DispositionChoice[];
  queue: QueuedLead[];
  // When set, every call is attributed to this campaign and the script
  // panel renders on the right.
  campaignId?: string | null;
  // Stable identifier for "resume where you left off". When provided,
  // we persist outcomes (handled lead ids + dispositions) to
  // localStorage so navigating away and coming back doesn't lose
  // progress — the next dial picks up at the first non-handled lead in
  // the (possibly refreshed) queue.
  sessionKey?: string | null;
  script?: ScriptRow | null;
  // When the campaign opted into TCPA, render a small badge on the
  // Ready card showing the lead-local time and whether we're inside
  // the dial window. Queue is pre-filtered server-side, but a lead can
  // tip past the boundary while sitting in the queue.
  tcpaPolicy?: TcpaPolicy | null;
  brandTimezone?: string;
}) {
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // Active script section. Null when the script is plain text or no
  // script attached. Reset to entry on each new call; advanced by the
  // disposition save callback for the *next* call.
  const [currentSectionId, setCurrentSectionId] = useState<string | null>(
    () => entrySectionId(script?.sections ?? null),
  );
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

  // localStorage key for resume-where-you-left-off. Null disables
  // persistence (ad-hoc filter sessions where the queue isn't stable).
  const storageKey = sessionKey ? `lp:dial-session:${sessionKey}` : null;
  const [resumed, setResumed] = useState(false);

  // On mount: rehydrate handled outcomes from localStorage. We then
  // skip the index past any leads that already have a saved outcome,
  // so the next dial picks up where the agent left off. Status stays
  // paused so the rep explicitly chooses to resume.
  useEffect(() => {
    if (!storageKey) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(storageKey);
    } catch {
      return;
    }
    if (!raw) return;
    let saved: { outcomes: Outcome[] } | null = null;
    try {
      saved = JSON.parse(raw) as { outcomes: Outcome[] };
    } catch {
      return;
    }
    if (!saved || !Array.isArray(saved.outcomes) || saved.outcomes.length === 0) return;
    const queueIds = new Set(queue.map((q) => q.id));
    const handled = saved.outcomes.filter((o) => queueIds.has(o.leadId));
    if (handled.length === 0) {
      // Nothing in the saved set still appears in the (refreshed)
      // queue — likely the dial-window already filtered them out.
      // Drop the stale entry so we don't keep parsing it.
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      return;
    }
    const handledIds = new Set(handled.map((o) => o.leadId));
    let i = 0;
    while (i < queue.length) {
      const q = queue[i];
      if (!q || !handledIds.has(q.id)) break;
      i++;
    }
    setOutcomes(handled);
    setIndex(i);
    setResumed(true);
    if (i >= queue.length) {
      setStatus({ kind: 'done' });
    } else {
      setStatus({ kind: 'paused' });
      autoAdvanceRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist outcomes whenever they change. Cleared when the queue
  // wraps up (status === 'done') so the next session starts fresh.
  useEffect(() => {
    if (!storageKey) return;
    if (outcomes.length === 0) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ outcomes }));
    } catch {
      /* quota — ignore */
    }
  }, [outcomes, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (status.kind !== 'done') return;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [status.kind, storageKey]);

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

  async function getClient(force = false): Promise<SignalWireClient> {
    if (clientRef.current && !force) return clientRef.current;
    if (force && clientRef.current) {
      try {
        await clientRef.current.disconnect();
      } catch {
        /* ignore */
      }
      clientRef.current = null;
    }
    const tokenRes = await fetch('/api/signalwire/token', { method: 'POST' });
    if (!tokenRes.ok) throw new Error('Could not get SignalWire token.');
    const { token } = (await tokenRes.json()) as { token: string };
    const client = await SignalWire({ token });
    clientRef.current = client;
    return client;
  }

  // SignalWire's SAT (and the underlying `authblock`) ages out after ~2h.
  // The cached client keeps trying to use it, so dial() fails with
  // 422 authblock_is_expired. Detect and force a fresh client + retry.
  function isAuthExpiredError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err ?? '');
    return /authblock_is_expired|authblock has passed|UnprocessableEntity/i.test(msg);
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
      const dialOnce = async () => {
        const client = await getClient();
        return client.dial({
          to: prep.fabricAddress,
          audio: true,
          video: false,
          negotiateVideo: false,
          userVariables: { t: prep.dialToken },
        });
      };
      let session: FabricRoomSession;
      try {
        session = await dialOnce();
      } catch (err) {
        if (!isAuthExpiredError(err)) throw err;
        // Token expired — force a new client + token, then retry once.
        await getClient(true);
        session = await dialOnce();
      }
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
    // Branching scripts: advance the section pointer for the *next* call.
    if (script?.sections) {
      const next = nextSectionForDisposition(script.sections, currentSectionId, code);
      if (next) setCurrentSectionId(next);
    }
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

  // Re-evaluate the dial window every time the lead changes. Cheap (no
  // I/O) so we can also retick on the elapsed counter to refresh the
  // displayed local clock minute-by-minute during a long wrap-up.
  const tcpaCheck = useMemo(() => {
    if (!tcpaPolicy?.enabled || !current) return null;
    return dialWindowCheck({
      leadState: current.state ?? null,
      brandTimezone,
      policy: tcpaPolicy,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tcpaPolicy, current?.id, current?.state, brandTimezone, status.kind]);

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
        {script && (
          <ScriptPanel
            script={script}
            currentSectionId={currentSectionId}
            onSelectSection={setCurrentSectionId}
          />
        )}
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
          {resumed && status.kind === 'paused' && (
            <div className="mb-3 rounded-lg border border-teal/30 bg-teal/5 px-3 py-1.5 text-[11.5px] text-teal">
              Resumed where you left off — {completed} already handled. Hit Resume to keep dialing.
            </div>
          )}

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
                {tcpaCheck && (
                  tcpaCheck.ok ? (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-teal/30 bg-teal/10 px-2 py-0.5 text-[10.5px] font-medium text-teal">
                      <span className="h-1 w-1 rounded-full bg-teal" />
                      Within window · {tcpaCheck.localHHMM} {tcpaCheck.leadTz}
                    </div>
                  ) : (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-hp/30 bg-hp/10 px-2 py-0.5 text-[10.5px] font-medium text-hp">
                      <span className="h-1 w-1 rounded-full bg-hp" />
                      {tcpaCheck.reason}
                    </div>
                  )
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
      {(status.kind === 'connecting' ||
        status.kind === 'in_call' ||
        status.kind === 'wrap_up') &&
        current && (
          <FloatingCallWidget
            status={status}
            lead={current}
            elapsed={elapsed}
            muted={muted}
            onMute={toggleMute}
            onHangup={hangupCurrent}
          />
        )}
    </div>
  );
}

// Draggable, position: fixed call panel that overlays the page during
// connecting / in-call / wrap-up. Always-visible reference for the rep:
// timer, mute, hang up. Position persists across reloads via
// localStorage so it lands wherever the rep last left it.
function FloatingCallWidget({
  status,
  lead,
  elapsed,
  muted,
  onMute,
  onHangup,
}: {
  status: Status;
  lead: QueuedLead;
  elapsed: number;
  muted: boolean;
  onMute: () => void;
  onHangup: () => void;
}) {
  const STORAGE_KEY = 'lp:call-widget-pos';
  const [mounted, setMounted] = useState(false);
  // Default: bottom-right with margins. Calculated lazily once we know
  // the viewport size in the browser.
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 24, y: 24 });
  const widgetRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  useEffect(() => {
    setMounted(true);
    let initial: { x: number; y: number } | null = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { x: number; y: number };
        if (typeof p.x === 'number' && typeof p.y === 'number') initial = p;
      }
    } catch {
      /* ignore */
    }
    if (initial) {
      setPos(clampToViewport(initial));
    } else {
      // Default: bottom-right, 24px margin, ~280x130 widget.
      setPos({ x: window.innerWidth - 280 - 24, y: window.innerHeight - 130 - 24 });
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only the header bar starts a drag — buttons stop propagation.
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
  }, [pos.x, pos.y]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const next = clampToViewport({
      x: d.origX + (e.clientX - d.startX),
      y: d.origY + (e.clientY - d.startY),
    });
    setPos(next);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
    } catch {
      /* ignore */
    }
  }, [pos]);

  if (!mounted) return null;

  const subline = leadSubline(lead);
  const labelText =
    status.kind === 'connecting'
      ? 'Calling…'
      : status.kind === 'in_call'
        ? 'On call'
        : 'Wrap-up';
  const dotCls =
    status.kind === 'in_call'
      ? 'bg-teal animate-pulse'
      : status.kind === 'connecting'
        ? 'bg-bs animate-pulse'
        : 'bg-txt-3';

  const node = (
    <div
      ref={widgetRef}
      className="fixed z-[60] w-[280px] select-none rounded-2xl border border-line bg-surface shadow-2xl"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex cursor-grab items-center gap-2 rounded-t-2xl border-b border-line bg-canvas px-3 py-1.5 active:cursor-grabbing"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
          {labelText}
        </span>
        {status.kind === 'in_call' && (
          <span className="ml-auto font-mono text-[11.5px] text-teal">
            {formatDur(elapsed)}
          </span>
        )}
      </div>
      <div className="px-3 py-2.5">
        <div className="truncate text-[13px] font-semibold text-txt-1">
          {leadDisplay(lead)}
        </div>
        {subline && (
          <div className="mt-0.5 truncate text-[11.5px] text-txt-3">{subline}</div>
        )}
        <div className="mt-1 truncate font-mono text-[11.5px] text-txt-2">
          {lead.phone}
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onMute}
            disabled={status.kind !== 'in_call'}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              muted
                ? 'border-hp bg-hp text-white'
                : 'border-line bg-canvas text-txt-2 hover:bg-surface'
            }`}
            title="Mute (M)"
          >
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            onClick={onHangup}
            disabled={status.kind === 'wrap_up'}
            className="flex-1 rounded-lg border border-hp bg-hp px-2 py-1.5 text-[11.5px] font-semibold text-white shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.22)] hover:bg-hp/90 disabled:cursor-not-allowed disabled:opacity-50"
            title="Hang up (H)"
          >
            Hang up
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

// Keep the widget within viewport bounds when dragged or after a
// resize. Approximate the widget at 280x130 — exact size doesn't
// matter, we just don't want it dragged offscreen.
function clampToViewport(p: { x: number; y: number }): { x: number; y: number } {
  if (typeof window === 'undefined') return p;
  const W = 280;
  const H = 130;
  const maxX = Math.max(0, window.innerWidth - W);
  const maxY = Math.max(0, window.innerHeight - H);
  return {
    x: Math.min(Math.max(0, p.x), maxX),
    y: Math.min(Math.max(0, p.y), maxY),
  };
}

// Lightweight panel pinned to the left of the dialer in campaign mode.
// Long scripts get a search box so reps can jump to the right beat.
// When the script defines sections, the panel becomes a tabbed view and
// shows a small "On <disposition> → <section>" hint below the body.
function ScriptPanel({
  script,
  currentSectionId,
  onSelectSection,
}: {
  script: ScriptRow;
  currentSectionId: string | null;
  onSelectSection: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const sections = script.sections;
  const activeSection: ScriptSection | null = sections
    ? sections.find((s) => s.id === currentSectionId) ?? sections[0] ?? null
    : null;
  const body = activeSection ? activeSection.body : script.body ?? '';
  // Highlight matches inline by wrapping each occurrence in <mark>. We
  // build a regex from the trimmed query; empty query renders as-is.
  const rendered = useMemo(() => {
    const q = query.trim();
    if (!q) return body;
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return body.replace(new RegExp(safe, 'gi'), (m) => `\u0001${m}\u0002`);
  }, [body, query]);

  const sectionTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sections ?? []) map.set(s.id, s.title);
    return map;
  }, [sections]);

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

      {sections && sections.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {sections.map((s) => {
            const isActive = s.id === activeSection?.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSection(s.id)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${
                  isActive
                    ? 'bg-teal/15 text-teal'
                    : 'border border-line bg-canvas text-txt-2 hover:border-teal/40 hover:text-teal'
                }`}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      )}

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

      {activeSection && (activeSection.jumps?.length ?? 0) > 0 && (
        <div className="mt-3 space-y-1 border-t border-line pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-txt-3">
            Next section
          </div>
          {activeSection.jumps?.map((j) => (
            <div key={`${j.disposition_code}-${j.target_section_id}`} className="text-[11px] text-txt-3">
              On <span className="text-txt-2">{j.disposition_code}</span> →{' '}
              <span className="text-txt-2">
                {sectionTitleById.get(j.target_section_id) ?? '—'}
              </span>
            </div>
          ))}
        </div>
      )}
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
