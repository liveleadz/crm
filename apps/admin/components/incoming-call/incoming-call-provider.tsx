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
import { SignalWire, type SignalWireClient } from '@signalwire/js';
import { claimRecentInboundCall } from '@/app/actions/dialer';
import type { DispositionChoice } from '@/components/dialer/disposition-picker';

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
  dispositions: DispositionChoice[];
  answer: () => Promise<void>;
  reject: () => Promise<void>;
  hangup: () => Promise<void>;
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
  on?: (event: string, cb: () => void) => void;
  hangup?: () => Promise<unknown>;
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
  const clientRef = useRef<SignalWireClient | null>(null);
  const inviteRef = useRef<LooseInvite | null>(null);
  const sessionRef = useRef<ActiveSession | null>(null);
  const callIdRef = useRef<string | null>(null);

  // Boot a long-lived SignalWire client and register for incoming calls.
  useEffect(() => {
    let cancelled = false;
    let client: SignalWireClient | null = null;

    (async () => {
      try {
        const tokenRes = await fetch('/api/signalwire/token', { method: 'POST' });
        if (!tokenRes.ok) return; // not signed in or env not set — silently skip
        const { token } = (await tokenRes.json()) as { token?: string };
        if (!token || cancelled) return;

        client = await SignalWire({ token });
        if (cancelled) {
          await client.disconnect().catch(() => undefined);
          return;
        }
        clientRef.current = client;

        await client.online({
          incomingCallHandlers: {
            all: ((notification: unknown) => {
              const inv = (notification as { invite?: LooseInvite })?.invite;
              if (!inv) return;
              const details = inv.details ?? {};
              inviteRef.current = inv;
              setPending({
                fromNumber:
                  cleanPhone(details.caller_id_number) ?? cleanPhone(details.from) ?? 'Unknown',
                toNumber: cleanPhone(details.callee_id_number) ?? cleanPhone(details.to) ?? '',
                leadName: cleanName(details.caller_id_name),
                receivedAt: Date.now(),
              });
            }) as never,
          },
        });
      } catch (e) {
        // Don't crash the app shell if the SDK fails to init — features
        // outside inbound calls keep working.
        console.error('[incoming-call] init failed', (e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      void client?.disconnect().catch(() => undefined);
    };
  }, []);

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
      // saved against the right call when the agent hangs up.
      void claimRecentInboundCall().then((res) => {
        if (res.ok) {
          callIdRef.current = res.callId;
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
      });
      setStatus({ kind: 'in_call', startedAt: Date.now() });
      setPending(null);
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
      void cleanup();
    }
  }, [cleanup]);

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
  }, []);

  const hangup = useCallback(async () => {
    const cid = callIdRef.current;
    await cleanup();
    if (cid) {
      setStatus({ kind: 'wrap_up', callId: cid });
    } else {
      setStatus({ kind: 'idle' });
    }
  }, [cleanup]);

  const closeWrapUp = useCallback(() => {
    callIdRef.current = null;
    setStatus({ kind: 'idle' });
  }, []);

  return (
    <IncomingCallContext.Provider
      value={{ pending, status, dispositions, answer, reject, hangup, closeWrapUp }}
    >
      {children}
    </IncomingCallContext.Provider>
  );
}
