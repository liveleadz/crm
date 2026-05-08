'use client';

// Persistent SignalWire JS subscriber. Stays online for the duration of
// the page session so PSTN inbound calls dispatched via
// <Dial><Client>email</Client></Dial> reach this browser. The SDK fires
// `incomingCallHandlers.all` with a notification carrying the invite —
// we surface caller info to the popup and accept/reject the invite when
// the user clicks.
//
// We deliberately don't pass rootElement on accept; audio-only calls
// route through the SDK's internal <audio> element. Passing the body
// would otherwise blank the page with a video container.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  attachSignalwireCallId,
  claimRecentInboundCall,
  transferCall,
} from '@/app/actions/dialer';
import type { DispositionChoice } from '@/components/dialer/disposition-picker';
import { useSignalWireClient } from '@/components/signalwire/signalwire-client-provider';

export type IncomingCall = {
  fromNumber: string;
  toNumber: string;
  leadName: string | null;
  receivedAt: number;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'in_call'; startedAt: number }
  | { kind: 'wrap_up'; callId: string }
  | { kind: 'error'; message: string };

type Ctx = {
  pending: IncomingCall | null;
  status: Status;
  muted: boolean;
  dispositions: DispositionChoice[];
  answer: () => Promise<void>;
  reject: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => Promise<void>;
  sendDigit: (digit: string) => Promise<void>;
  transfer: (targetE164: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  closeWrapUp: () => void;
};

const IncomingCallContext = createContext<Ctx | null>(null);

export function useIncomingCall(): Ctx {
  const ctx = useContext(IncomingCallContext);
  if (!ctx) throw new Error('useIncomingCall must be used inside IncomingCallProvider');
  return ctx;
}

// Loose shape for the SDK's incoming-call notification + invite. We treat
// these as opaque so the component compiles regardless of minor SDK type
// drift; the runtime shape is what matters.
type LooseInvite = {
  accept: (params: Record<string, unknown>) => Promise<unknown>;
  reject: () => Promise<unknown>;
  on?: (event: string, handler: () => void) => void;
  off?: (event: string, handler: () => void) => void;
  details?: {
    caller_id_number?: string;
    caller_id_name?: string;
    callee_id_number?: string;
    callee_id_name?: string;
    from?: string;
    to?: string;
  };
};

type ActiveSession = {
  id?: string;
  on?: (event: string, cb: () => void) => void;
  hangup?: () => Promise<unknown>;
  audioMute?: () => Promise<unknown>;
  audioUnmute?: () => Promise<unknown>;
  sendDigits?: (s: string) => Promise<unknown>;
  localStream?: MediaStream;
  localAudioTrack?: MediaStreamTrack | null;
};

// SignalWire occasionally hands us garbage caller-id strings — most
// commonly the literal "_undef_" placeholder when no CNAM exists. Strip
// those so the popup shows nothing rather than meaningless tokens.
function cleanName(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === '_undef_' || trimmed === '-' || trimmed === 'unknown') {
    return null;
  }
  return trimmed;
}

// Phone fields can come as a bare E.164 ("+12025550000"), a SIP URI
// ("sip:+15619415323@sip.signalwire.com"), or a TEL URI. Reduce all of
// them to a plain E.164 string for display.
function cleanPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // SIP / TEL URI: strip scheme + @host
  const sipMatch = trimmed.match(/^(?:sip|sips|tel):([^@;]+)/i);
  if (sipMatch?.[1]) return decodeURIComponent(sipMatch[1]);
  return trimmed;
}

export function IncomingCallProvider({
  children,
  dispositions,
}: {
  children: React.ReactNode;
  dispositions: DispositionChoice[];
}) {
  const [pending, setPending] = useState<IncomingCall | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [muted, setMuted] = useState(false);
  const inviteRef = useRef<LooseInvite | null>(null);
  const sessionRef = useRef<ActiveSession | null>(null);
  const callIdRef = useRef<string | null>(null);

  // Shared SignalWire client (one per tab) — owns SAT minting + 30-min
  // rotation + auto re-arm of online() on every refresh. We just feed
  // it our invite handler and report busy state so it knows when to
  // skip rotation.
  const { setIncomingHandler, setBusy } = useSignalWireClient();

  // Register the inbound invite handler exactly once. The shared client
  // provider re-arms online() with this handler on every rotation, so
  // the subscription survives token refresh without anything here.
  useEffect(() => {
    setIncomingHandler((notification) => {
      console.log('[incoming-call] invite received', notification);
      const inv = (notification as { invite?: LooseInvite })?.invite;
      if (!inv) return;
      const details = inv.details ?? {};
      inviteRef.current = inv;
      const receivedAt = Date.now();
      const onCancelled = () => {
        if (inviteRef.current === inv) {
          inviteRef.current = null;
          setBusy('incoming', false);
          setPending((cur) => (cur && cur.receivedAt === receivedAt ? null : cur));
        }
      };
      try {
        inv.on?.('destroy', onCancelled);
      } catch {
        /* no-op */
      }
      window.setTimeout(() => {
        if (inviteRef.current === inv) onCancelled();
      }, 60_000);
      // Tell the shared client we're busy — rotation will hold off
      // until the invite is accepted/rejected/timed out.
      setBusy('incoming', true);
      setPending({
        fromNumber:
          cleanPhone(details.caller_id_number) ?? cleanPhone(details.from) ?? 'Unknown',
        toNumber: cleanPhone(details.callee_id_number) ?? cleanPhone(details.to) ?? '',
        leadName: cleanName(details.caller_id_name),
        receivedAt,
      });
    });
    return () => {
      setIncomingHandler(null);
      setBusy('incoming', false);
    };
  }, [setIncomingHandler, setBusy]);

  const cleanup = useCallback(async () => {
    inviteRef.current = null;
    if (sessionRef.current?.hangup) {
      try {
        await sessionRef.current.hangup();
      } catch {
        /* already gone */
      }
    }
    sessionRef.current = null;
  }, []);

  const answer = useCallback(async () => {
    const invite = inviteRef.current;
    if (!invite || !invite.accept) return;
    setStatus({ kind: 'connecting' });
    try {
      const session = (await invite.accept({
        audio: true,
        video: false,
        negotiateVideo: false,
      })) as ActiveSession;
      sessionRef.current = session;
      // Map this SDK invite to our internal call row so disposition can be
      // saved against the right call when the agent hangs up. Also persist
      // the SignalWire CallSid (FabricRoomSession.id) so blind transfer
      // can issue a LaML Modify Call against this leg.
      const swCallId = session.id;
      void claimRecentInboundCall().then((res) => {
        if (res.ok) {
          callIdRef.current = res.callId;
          if (swCallId) {
            void attachSignalwireCallId({
              callId: res.callId,
              signalwireCallId: swCallId,
            });
          }
          setPending((prev) =>
            prev
              ? {
                  ...prev,
                  fromNumber: res.fromNumber || prev.fromNumber,
                  toNumber: res.toNumber || prev.toNumber,
                  leadName: res.leadName || prev.leadName,
                }
              : prev,
          );
        }
      });
      session.on?.('destroy', () => {
        const cid = callIdRef.current;
        if (cid) {
          setStatus({ kind: 'wrap_up', callId: cid });
        } else {
          setStatus({ kind: 'idle' });
        }
        sessionRef.current = null;
        setBusy('incoming', false);
      });
      setStatus({ kind: 'in_call', startedAt: Date.now() });
      setPending(null);
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
      setBusy('incoming', false);
      void cleanup();
    }
  }, [cleanup, setBusy]);

  const reject = useCallback(async () => {
    const invite = inviteRef.current;
    setPending(null);
    if (invite?.reject) {
      try {
        await invite.reject();
      } catch {
        /* invite may have already timed out */
      }
    }
    inviteRef.current = null;
    setBusy('incoming', false);
  }, [setBusy]);

  const hangup = useCallback(async () => {
    const cid = callIdRef.current;
    await cleanup();
    if (cid) {
      setStatus({ kind: 'wrap_up', callId: cid });
    } else {
      setStatus({ kind: 'idle' });
    }
    setBusy('incoming', false);
  }, [cleanup, setBusy]);

  const closeWrapUp = useCallback(() => {
    callIdRef.current = null;
    setMuted(false);
    setStatus({ kind: 'idle' });
  }, []);

  // Mute the local microphone. SignalWire's `audioMute()` is a
  // conference/room-level mute that does not reliably disable the
  // outbound WebRTC audio track on 1:1 PSTN calls. We disable the
  // MediaStreamTrack directly (WebRTC spec guarantees zero outbound
  // audio when `track.enabled` is false) and best-effort call the
  // SDK API so its UI state stays in sync.
  const toggleMute = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const next = !muted;
    const tracks: MediaStreamTrack[] = [];
    if (session.localAudioTrack) tracks.push(session.localAudioTrack);
    for (const t of session.localStream?.getAudioTracks?.() ?? []) {
      if (!tracks.includes(t)) tracks.push(t);
    }
    if (tracks.length === 0) {
      console.warn('[incoming-call] no local audio track found for mute toggle');
    }
    for (const t of tracks) t.enabled = !next;
    try {
      if (next) await session.audioMute?.();
      else await session.audioUnmute?.();
    } catch (e) {
      console.warn('[incoming-call] SDK audioMute reported error', e);
    }
    setMuted(next);
  }, [muted]);

  // DTMF for IVR navigation while on an inbound call (e.g. agent forwarded
  // into a third-party tree). Soft no-op if the SDK build doesn't expose
  // sendDigits on the active session.
  const sendDigit = useCallback(async (digit: string) => {
    const session = sessionRef.current;
    if (!session?.sendDigits) return;
    try {
      await session.sendDigits(digit);
    } catch (e) {
      console.warn('[incoming-call] sendDigits failed', e);
    }
  }, []);

  // Blind transfer: server replaces the SWML on the parent CallSid we
  // attached on answer; the SDK fires 'destroy' shortly after, taking us
  // into wrap_up just like a hangup. The agent can still set a
  // disposition.
  const transfer = useCallback(async (targetE164: string) => {
    const cid = callIdRef.current;
    if (!cid) return { ok: false as const, error: 'No active call.' };
    return transferCall({ callId: cid, targetE164 });
  }, []);

  return (
    <IncomingCallContext.Provider
      value={{
        pending,
        status,
        muted,
        dispositions,
        answer,
        reject,
        hangup,
        toggleMute,
        sendDigit,
        transfer,
        closeWrapUp,
      }}
    >
      {children}
    </IncomingCallContext.Provider>
  );
}
