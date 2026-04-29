'use client';

// WebRTC dialer (v2). Initializes a SignalWire Call Fabric client with a
// SAT token fetched from /api/signalwire/token, then dials our private
// `leadpilot-dialer` resource which bridges to the lead with the brand's
// caller-ID. Audio is captured from the laptop mic and rendered through
// the SDK's internal <audio> element — no phone bridge.

import { useEffect, useRef, useState, useTransition } from 'react';
import { SignalWire, type SignalWireClient, type FabricRoomSession } from '@signalwire/js';
import { attachSignalwireCallId, markCallEnded, prepareCall } from '@/app/actions/dialer-v2';

const KEYS: { value: string; sub?: string }[] = [
  { value: '1' },
  { value: '2', sub: 'ABC' },
  { value: '3', sub: 'DEF' },
  { value: '4', sub: 'GHI' },
  { value: '5', sub: 'JKL' },
  { value: '6', sub: 'MNO' },
  { value: '7', sub: 'PQRS' },
  { value: '8', sub: 'TUV' },
  { value: '9', sub: 'WXYZ' },
  { value: '*' },
  { value: '0', sub: '+' },
  { value: '#' },
];

type Props = {
  brandName: string | null;
  fromE164: string | null;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'in_call'; startedAt: number }
  | { kind: 'error'; message: string };

export function WebRTCDialPad({ brandName, fromE164 }: Props) {
  const [number, setNumber] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [muted, setMuted] = useState(false);
  const [, startTransition] = useTransition();
  const [elapsed, setElapsed] = useState(0);
  const clientRef = useRef<SignalWireClient | null>(null);
  const sessionRef = useRef<FabricRoomSession | null>(null);
  const callIdRef = useRef<string | null>(null);

  // Tick the duration display once per second while in a call.
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
      void sessionRef.current?.hangup?.().catch(() => undefined);
      void clientRef.current?.disconnect?.().catch(() => undefined);
    };
  }, []);

  function press(k: string) {
    setNumber((n) => (n + k).slice(0, 20));
  }
  function backspace() {
    setNumber((n) => n.slice(0, -1));
  }

  async function getClient(): Promise<SignalWireClient> {
    if (clientRef.current) return clientRef.current;
    const tokenRes = await fetch('/api/signalwire/token', { method: 'POST' });
    if (!tokenRes.ok) {
      throw new Error(`Token fetch failed (${tokenRes.status})`);
    }
    const { token } = (await tokenRes.json()) as { token: string };
    const client = await SignalWire({ token });
    clientRef.current = client;
    return client;
  }

  async function placeCall() {
    if (!number.trim() || status.kind !== 'idle') return;
    setStatus({ kind: 'connecting' });
    try {
      const prep = await prepareCall({ toNumber: number });
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
      });
      sessionRef.current = session;

      // Persist the SignalWire-side identifier so status callbacks can
      // map back to our row.
      const swCallId = (session as unknown as { id?: string }).id;
      if (swCallId) {
        startTransition(() => {
          void attachSignalwireCallId({
            callId: prep.callId,
            signalwireCallId: swCallId,
          });
        });
      }

      session.on?.('destroy', () => {
        finishCall();
      });

      await session.start();
      setStatus({ kind: 'in_call', startedAt: Date.now() });
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message ?? 'Call failed.' });
    }
  }

  async function hangup() {
    const session = sessionRef.current;
    if (!session) return;
    try {
      await session.hangup();
    } catch {
      // ignore — we still want to finish the call locally
    }
    finishCall();
  }

  function finishCall() {
    const cid = callIdRef.current;
    const startedAt = status.kind === 'in_call' ? status.startedAt : null;
    sessionRef.current = null;
    callIdRef.current = null;
    if (cid) {
      const duration = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : undefined;
      startTransition(() => {
        void markCallEnded({ callId: cid, durationSec: duration });
      });
    }
    setStatus({ kind: 'idle' });
    setMuted(false);
  }

  async function toggleMute() {
    const session = sessionRef.current;
    if (!session) return;
    if (muted) {
      await session.audioUnmute();
      setMuted(false);
    } else {
      await session.audioMute();
      setMuted(true);
    }
  }

  const inCall = status.kind === 'in_call';
  const callDisabled =
    !number.trim() || status.kind === 'connecting' || status.kind === 'in_call' || !fromE164;

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-line bg-surface p-5">
      {fromE164 ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2 text-[11.5px]">
          <span className="text-txt-3">Caller ID</span>
          <span className="font-mono text-txt">{fromE164}</span>
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] text-hp">
          No outbound number assigned to {brandName ?? 'this brand'}.
        </div>
      )}

      <div className="mb-4">
        <input
          type="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !inCall) void placeCall();
          }}
          disabled={inCall}
          placeholder="Enter phone number"
          className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-center font-mono text-[18px] tracking-wide outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20 disabled:opacity-60"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => press(k.value)}
            disabled={inCall}
            className="grid h-14 place-items-center rounded-xl border border-line bg-canvas hover:bg-surface-2 active:scale-95 disabled:opacity-50"
          >
            <span className="font-mono text-[18px] font-medium">{k.value}</span>
            {k.sub && <span className="text-[9px] text-txt-3">{k.sub}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {!inCall ? (
          <>
            <button
              type="button"
              onClick={backspace}
              disabled={!number || status.kind === 'connecting'}
              className="grid h-12 w-12 place-items-center rounded-xl border border-line text-txt-3 hover:bg-canvas disabled:opacity-30"
              aria-label="Backspace"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void placeCall()}
              disabled={callDisabled}
              className="flex-1 rounded-xl bg-teal py-3 text-[13px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
            >
              {status.kind === 'connecting' ? 'Connecting…' : 'Call'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void toggleMute()}
              className={`grid h-12 w-12 place-items-center rounded-xl border ${
                muted ? 'border-hp/40 bg-hp/10 text-hp' : 'border-line text-txt-3 hover:bg-canvas'
              }`}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {muted ? (
                  <>
                    <path d="M1 1l22 22" strokeLinecap="round" />
                    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                  </>
                ) : (
                  <>
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                  </>
                )}
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void hangup()}
              className="flex-1 rounded-xl bg-hp py-3 text-[13px] font-semibold text-white hover:bg-hp/90"
            >
              Hang up · {formatDuration(elapsed)}
            </button>
          </>
        )}
      </div>

      {status.kind === 'connecting' && (
        <div className="mt-3 rounded-lg border border-line bg-canvas px-3 py-2 text-[11.5px] leading-snug text-txt-3">
          Connecting…
        </div>
      )}
      {status.kind === 'in_call' && (
        <div className="mt-3 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-[11.5px] leading-snug text-teal">
          Connected — talking through your laptop mic.
        </div>
      )}
      {status.kind === 'error' && (
        <div className="mt-3 rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] leading-snug text-hp">
          {status.message}
        </div>
      )}
    </div>
  );
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
