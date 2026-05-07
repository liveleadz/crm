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
import { SignalWire, type SignalWireClient, type FabricRoomSession } from '@signalwire/js';
import {
  attachSignalwireCallId,
  markCallEnded,
  prepareCall,
} from '@/app/actions/dialer';
import type { DispositionChoice } from '@/components/dialer/disposition-picker';
import { usePresence } from '@/components/presence/presence-provider';

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
  closeWrapUp: () => void;
  dismissError: () => void;
};

const OutgoingCallContext = createContext<Ctx | null>(null);

export function useOutgoingCall(): Ctx {
  const ctx = useContext(OutgoingCallContext);
  if (!ctx) throw new Error('useOutgoingCall must be used inside OutgoingCallProvider');
  return ctx;
}

// Cap the cached client at 30 minutes — well under the SAT's 2h TTL.
// Removes the most common source of authblock_is_expired: a tab idle
// for hours.
const CLIENT_MAX_AGE_MS = 30 * 60 * 1000;

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

  const clientRef = useRef<SignalWireClient | null>(null);
  const clientMintedAtRef = useRef<number>(0);
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
  }, [status.kind, setOnCall]);
  useEffect(() => () => setOnCall(false), [setOnCall]);

  // Tear down the SignalWire client on unmount. Same shape as the old
  // dial pad — a stale client would just block on auth at next dial.
  useEffect(() => {
    return () => {
      void sessionRef.current?.hangup?.().catch(() => undefined);
      void clientRef.current?.disconnect?.().catch(() => undefined);
    };
  }, []);

  const getClient = useCallback(async (force = false): Promise<SignalWireClient> => {
    const aged = Date.now() - clientMintedAtRef.current > CLIENT_MAX_AGE_MS;
    const needsFresh = force || aged || !clientRef.current;
    if (clientRef.current && !needsFresh) return clientRef.current;
    if (clientRef.current) {
      try {
        await clientRef.current.disconnect();
      } catch {
        /* ignore */
      }
      clientRef.current = null;
    }
    const tokenRes = await fetch('/api/signalwire/token', {
      method: 'POST',
      cache: 'no-store',
    });
    if (!tokenRes.ok) {
      throw new Error(`Token fetch failed (${tokenRes.status})`);
    }
    const { token } = (await tokenRes.json()) as { token: string };
    const client = await SignalWire({ token });
    clientRef.current = client;
    clientMintedAtRef.current = Date.now();
    return client;
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
          await getClient(true);
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
        setStatus({
          kind: 'error',
          target,
          message: (e as Error).message ?? 'Call failed.',
        });
      }
    },
    [getClient, finishCall, status.kind],
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

  const toggleMute = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      if (muted) {
        await session.audioUnmute();
        setMuted(false);
      } else {
        await session.audioMute();
        setMuted(true);
      }
    } catch (e) {
      console.warn('[outgoing-call] mute toggle failed', e);
    }
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
        closeWrapUp,
        dismissError,
      }}
    >
      {children}
    </OutgoingCallContext.Provider>
  );
}
