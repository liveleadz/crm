'use client';

// Global outbound-call state. Lives at app-layout level so the call (and
// its popup) survives any in-app navigation — the rep can move from
// /dialer to /leads while talking and the line stays open.
//
// The provider owns the SignalWire Fabric client used for outbound dials
// (outbound only — IncomingCallProvider keeps its own client subscribed
// for inbound). Mirrors the placeCall logic that previously lived inside
// WebRTCDialPad: prepareCall → dial → start with auth-expired retry,
// duration tracking, and post-call wrap_up gated on disposition.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { type FabricRoomSession } from '@signalwire/js';
import {
  attachSignalwireCallId,
  markCallEnded,
  prepareCall,
  transferCall,
} from '@/app/actions/dialer';
import type { DispositionChoice } from '@/components/dialer/disposition-picker';
import { usePresence } from '@/components/presence/presence-provider';
import { useSignalWireClient } from '@/components/signalwire/signalwire-client-provider';

export type OutgoingCallTarget = {
  toNumber: string;
  leadId: string | null;
  // Display-only metadata. Not used for routing — the SWML webhook reads
  // the caller-id from the signed dial token. We surface them in the
  // popup chrome ("BrandName · +1…") to match the screenshot.
  brandName: string | null;
  fromE164: string | null;
  // Optional pre-resolved display name; the popup falls back to the
  // phone number when this is null.
  leadName?: string | null;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'connecting'; target: OutgoingCallTarget }
  | { kind: 'in_call'; target: OutgoingCallTarget; startedAt: number; callId: string }
  | { kind: 'wrap_up'; target: OutgoingCallTarget; callId: string }
  | { kind: 'error'; target: OutgoingCallTarget; message: string };

type Ctx = {
  status: Status;
  muted: boolean;
  onHold: boolean;
  dispositions: DispositionChoice[];
  start: (target: OutgoingCallTarget) => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleHold: () => Promise<void>;
  sendDigit: (digit: string) => Promise<void>;
  transfer: (targetE164: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  closeWrapUp: () => void;
  dismissError: () => void;
};

const OutgoingCallContext = createContext<Ctx | null>(null);

export function useOutgoingCall(): Ctx {
  const ctx = useContext(OutgoingCallContext);
  if (!ctx) throw new Error('useOutgoingCall must be used inside OutgoingCallProvider');
  return ctx;
}

function isAuthExpiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /authblock_is_expired|authblock has passed|UnprocessableEntity/i.test(msg);
}

export function OutgoingCallProvider({
  children,
  dispositions,
}: {
  children: ReactNode;
  dispositions: DispositionChoice[];
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const { setOnCall } = usePresence();
  // Shared SignalWire client (one per tab). Eliminates the cross-
  // provider authblock race that we hit in 0046 — with one client in
  // play, rotating it never stomps a separate authblock owned by the
  // inbound side.
  const { getClient, refreshNow, setBusy } = useSignalWireClient();

  const sessionRef = useRef<FabricRoomSession | null>(null);
  const callIdRef = useRef<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  // Mirror status into presence so managers see the on_call dot light up
  // on the Live Floor / Live Team widget while a dial is in flight.
  useEffect(() => {
    const onCall =
      status.kind === 'connecting' ||
      status.kind === 'in_call' ||
      status.kind === 'wrap_up';
    setOnCall(onCall);
    // Same flag tells the shared client provider to defer rotation while
    // we're mid-dial — tearing the client down between connecting and
    // in_call would otherwise drop the call.
    setBusy('outgoing', onCall);
  }, [status.kind, setOnCall, setBusy]);
  useEffect(() => () => {
    setOnCall(false);
    setBusy('outgoing', false);
  }, [setOnCall, setBusy]);

  // Tear down the active session on unmount. The shared client itself
  // is owned by SignalWireClientProvider and lives on.
  useEffect(() => {
    return () => {
      void sessionRef.current?.hangup?.().catch(() => undefined);
    };
  }, []);

  // Internal: mark this call ended locally + tell the server.
  const finishCall = useCallback(
    (target: OutgoingCallTarget) => {
      const cid = callIdRef.current;
      const startedAt = startedAtRef.current;
      sessionRef.current = null;
      callIdRef.current = null;
      startedAtRef.current = null;
      setMuted(false);
      setOnHold(false);
      if (cid) {
        const duration = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : undefined;
        void markCallEnded({ callId: cid, durationSec: duration });
        setStatus({ kind: 'wrap_up', target, callId: cid });
      } else {
        setStatus({ kind: 'idle' });
      }
    },
    [],
  );

  const start = useCallback(
    async (target: OutgoingCallTarget) => {
      // Refuse to overlap an active dial; the popup's UI hides the
      // keypad's Call button while not idle, but a stale ref-clicked
      // shortcut could still race in.
      if (
        status.kind === 'connecting' ||
        status.kind === 'in_call' ||
        status.kind === 'wrap_up'
      ) {
        return;
      }
      setStatus({ kind: 'connecting', target });
      try {
        const prep = await prepareCall({
          toNumber: target.toNumber,
          leadId: target.leadId,
        });
        if (!prep.ok) {
          setStatus({ kind: 'error', target, message: prep.error });
          return;
        }
        callIdRef.current = prep.callId;

        const dialAndStart = async (): Promise<FabricRoomSession> => {
          const client = await getClient();
          const session = await client.dial({
            to: prep.fabricAddress,
            audio: true,
            video: false,
            negotiateVideo: false,
            // Primary channel for passing our signed dial token to the
            // SWML webhook. Forwarded in the webhook request body as
            // call.user_variables.t. URL query string is a fallback.
            userVariables: { t: prep.dialToken },
          });
          // Attach destroy listener BEFORE start so an immediate
          // teardown (auth retry path) still cleans up locally.
          session.on?.('destroy', () => finishCall(target));
          await session.start();
          return session;
        };

        let session: FabricRoomSession;
        try {
          session = await dialAndStart();
        } catch (err) {
          if (!isAuthExpiredError(err)) throw err;
          console.warn('[outgoing-call] auth expired, refreshing token and retrying', err);
          try {
            await sessionRef.current?.hangup?.();
          } catch {
            /* ignore */
          }
          sessionRef.current = null;
          // Mint a brand-new client; subsequent dialAndStart() will
          // pick it up via getClient() inside dialAndStart's closure.
          await refreshNow();
          session = await dialAndStart();
        }
        sessionRef.current = session;

        const swCallId = (session as unknown as { id?: string }).id;
        if (swCallId) {
          void attachSignalwireCallId({
            callId: prep.callId,
            signalwireCallId: swCallId,
          });
        }

        const startedAt = Date.now();
        startedAtRef.current = startedAt;
        setStatus({ kind: 'in_call', target, startedAt, callId: prep.callId });
      } catch (e) {
        console.error('[outgoing-call] start failed', e);
        // After a token-refresh retry, if SignalWire still rejects with
        // an expired authblock, the SDK's in-page state is stuck. The
        // only reliable recovery is a hard page reload — the raw 422
        // JSON is useless to the agent, so swap it for an actionable
        // hint.
        const msg = isAuthExpiredError(e)
          ? 'Call session expired. Please reload the page and try again.'
          : ((e as Error).message ?? 'Call failed.');
        setStatus({ kind: 'error', target, message: msg });
      }
    },
    [getClient, refreshNow, finishCall, status.kind],
  );

  const hangup = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      await session.hangup();
    } catch {
      // already gone — finishCall will still fire via the destroy event
    }
    // finishCall is invoked by the SDK destroy listener; no-op here.
  }, []);

  // Mute the local microphone. SignalWire's `audioMute()` is a
  // conference/room-level mute that does not reliably disable the
  // outbound WebRTC audio track on 1:1 PSTN calls — the remote party
  // could still hear us. We disable the MediaStreamTrack directly
  // (WebRTC spec guarantees zero outbound audio when `track.enabled`
  // is false) and best-effort call the SDK API so its UI state stays
  // in sync.
  const toggleMute = useCallback(async () => {
    const session = sessionRef.current as unknown as {
      localStream?: MediaStream;
      localAudioTrack?: MediaStreamTrack | null;
      audioMute?: () => Promise<unknown>;
      audioUnmute?: () => Promise<unknown>;
    } | null;
    if (!session) return;
    const next = !muted;
    const tracks: MediaStreamTrack[] = [];
    if (session.localAudioTrack) tracks.push(session.localAudioTrack);
    for (const t of session.localStream?.getAudioTracks?.() ?? []) {
      if (!tracks.includes(t)) tracks.push(t);
    }
    if (tracks.length === 0) {
      console.warn('[outgoing-call] no local audio track found for mute toggle');
    }
    for (const t of tracks) t.enabled = !next;
    try {
      if (next) await session.audioMute?.();
      else await session.audioUnmute?.();
    } catch (e) {
      // Track-level mute already took effect; SDK API mismatch is
      // non-fatal but worth logging in case the build needs work.
      console.warn('[outgoing-call] SDK audioMute reported error', e);
    }
    setMuted(next);
  }, [muted]);

  // Hold = silence both directions. Browser SDKs don't have a true PSTN
  // hold (no music-on-hold from the carrier side), so we mute the local
  // mic and stop pulling audio. Honest behavior: caller hears silence.
  const toggleHold = useCallback(async () => {
    const session = sessionRef.current as unknown as {
      audioMute?: () => Promise<unknown>;
      audioUnmute?: () => Promise<unknown>;
    } | null;
    if (!session) return;
    try {
      if (onHold) {
        await session.audioUnmute?.();
        setOnHold(false);
      } else {
        await session.audioMute?.();
        setOnHold(true);
      }
    } catch (e) {
      console.warn('[outgoing-call] hold toggle failed', e);
    }
  }, [onHold]);

  // DTMF for IVR navigation. The Fabric SDK exposes sendDigits on the
  // active session; if a build doesn't, this is a soft no-op.
  const sendDigit = useCallback(async (digit: string) => {
    const session = sessionRef.current as unknown as {
      sendDigits?: (s: string) => Promise<unknown>;
    } | null;
    if (!session?.sendDigits) return;
    try {
      await session.sendDigits(digit);
    } catch (e) {
      console.warn('[outgoing-call] sendDigits failed', e);
    }
  }, []);

  // Blind transfer the in-flight call to a typed number. Server action
  // does the SignalWire LaML Modify Call; on success the SDK fires
  // 'destroy' on the parent session because the SWML script gets
  // replaced, which routes us through finishCall → wrap_up like a
  // normal hangup. The agent can still set a disposition.
  const transfer = useCallback(
    async (targetE164: string) => {
      const callId = callIdRef.current;
      if (!callId) return { ok: false as const, error: 'No active call.' };
      const res = await transferCall({ callId, targetE164 });
      return res;
    },
    [],
  );

  const closeWrapUp = useCallback(() => {
    setStatus({ kind: 'idle' });
  }, []);

  const dismissError = useCallback(() => {
    setStatus({ kind: 'idle' });
  }, []);

  return (
    <OutgoingCallContext.Provider
      value={{
        status,
        muted,
        onHold,
        dispositions,
        start,
        hangup,
        toggleMute,
        toggleHold,
        sendDigit,
        transfer,
        closeWrapUp,
        dismissError,
      }}
    >
      {children}
    </OutgoingCallContext.Provider>
  );
}
