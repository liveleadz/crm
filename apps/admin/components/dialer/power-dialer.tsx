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
  markCallEnded,
  prepareCall,
} from '@/app/actions/dialer';
import {
  DispositionPicker,
  type DispositionChoice,
} from '@/components/dialer/disposition-picker';
import { RecordingButton } from '@/components/calls/recording-button';
import type { QueuedLead } from '@/lib/dial-queue';

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
}: {
  brandName: string | null;
  fromE164: string | null;
  dispositions: DispositionChoice[];
  queue: QueuedLead[];
}) {
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [muted, setMuted] = useState(false);
  const [, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(0);
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
      const prep = await prepareCall({ toNumber: lead.phone, leadId: lead.id });
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
    <div className="mx-auto w-full max-w-3xl">
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
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
                {current && (
                  <div className="mt-0.5 truncate font-mono text-[12px] text-txt-3">
                    {current.phone}
                    {current.email && (
                      <span className="ml-2 font-sans normal-case text-txt-3">
                        · {current.email}
                      </span>
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
              </div>

              {status.kind === 'wrap_up' ? (
                <DispositionPicker
                  callId={status.callId}
                  choices={dispositions}
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
          {queue.slice(index, index + 30).map((l, i) => (
            <div
              key={l.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] ${
                i === 0
                  ? 'bg-teal/10 text-teal ring-1 ring-teal/40'
                  : 'text-txt-2 hover:bg-canvas'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  i === 0 ? 'bg-teal' : 'bg-line-2'
                }`}
              />
              <span className="truncate">{leadDisplay(l)}</span>
              <span className="ml-auto truncate font-mono text-[10.5px] text-txt-3">
                {l.phone}
              </span>
            </div>
          ))}
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
    </div>
  );
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

function leadDisplay(l: QueuedLead): string {
  const n = [l.firstName, l.lastName].filter(Boolean).join(' ').trim();
  return n || l.phone;
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
