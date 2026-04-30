'use client';

// Subscribes the current member's browser to inbound-call notifications and
// surfaces them through a context that <IncomingCallPopup> renders. When
// an inbound call lands on a routed brand number, the SWML inbound route
// (a) drops the PSTN caller into a conference room and (b) inserts a row
// into `notifications` with kind='inbound_call'. Supabase realtime
// streams that row to any connected browser whose recipient_member_id
// matches; the popup answers/rejects.
//
// Answer flow: prepareInboundAnswer() returns a SignalWire Call Fabric
// address + dial token whose SWML response connects the agent's WebRTC
// leg to the same conference. Two parties, one room, audio bridged.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@leadpilot/db/client';
import { SignalWire, type SignalWireClient, type FabricRoomSession } from '@signalwire/js';
import { prepareInboundAnswer, markNotificationHandled } from '@/app/actions/dialer';

export type IncomingCall = {
  notificationId: string;
  callId: string;
  fromNumber: string;
  toNumber: string;
  leadName: string | null;
  leadId: string | null;
  conference: string;
  receivedAt: number;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'in_call'; startedAt: number }
  | { kind: 'error'; message: string };

type Ctx = {
  pending: IncomingCall | null;
  status: Status;
  answer: () => Promise<void>;
  reject: () => Promise<void>;
  hangup: () => Promise<void>;
};

const IncomingCallContext = createContext<Ctx | null>(null);

export function useIncomingCall(): Ctx {
  const ctx = useContext(IncomingCallContext);
  if (!ctx) throw new Error('useIncomingCall must be used inside IncomingCallProvider');
  return ctx;
}

export function IncomingCallProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<IncomingCall | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const clientRef = useRef<SignalWireClient | null>(null);
  const sessionRef = useRef<FabricRoomSession | null>(null);

  // Subscribe to Supabase realtime for new inbound_call notifications
  // addressed to the current member. Triggers the popup.
  useEffect(() => {
    const supabase = createBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      channel = supabase
        .channel(`inbound-calls-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_member_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as {
              id: string;
              kind: string;
              data: Record<string, unknown> | null;
            };
            if (row.kind !== 'inbound_call' || !row.data) return;
            const data = row.data;
            const callId = String(data.call_id ?? '');
            const conference = String(data.conference_name ?? '');
            if (!callId || !conference) return;
            setPending({
              notificationId: row.id,
              callId,
              fromNumber: String(data.from_number ?? 'Unknown'),
              toNumber: String(data.to_number ?? ''),
              leadName: (data.lead_name as string | null) ?? null,
              leadId: (data.lead_id as string | null) ?? null,
              conference,
              receivedAt: Date.now(),
            });
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Tear down any live session on unmount.
  useEffect(() => {
    return () => {
      sessionRef.current?.hangup().catch(() => undefined);
      clientRef.current?.disconnect().catch(() => undefined);
    };
  }, []);

  const cleanup = useCallback(async () => {
    if (sessionRef.current) {
      try {
        await sessionRef.current.hangup();
      } catch {
        /* already gone */
      }
      sessionRef.current = null;
    }
    if (clientRef.current) {
      try {
        await clientRef.current.disconnect();
      } catch {
        /* already gone */
      }
      clientRef.current = null;
    }
  }, []);

  const answer = useCallback(async () => {
    if (!pending) return;
    setStatus({ kind: 'connecting' });
    try {
      const prep = await prepareInboundAnswer({ callId: pending.callId });
      if (!prep.ok) throw new Error(prep.error);

      // Fetch a fresh SAT token for the SDK.
      const tokenRes = await fetch('/api/signalwire/token', { method: 'POST' });
      const tokenJson = (await tokenRes.json()) as { token?: string; error?: string };
      if (!tokenRes.ok || !tokenJson.token) {
        throw new Error(tokenJson.error || 'Failed to fetch SignalWire token');
      }

      const client = await SignalWire({ token: tokenJson.token });
      clientRef.current = client;

      const session = await client.dial({
        to: prep.fabricAddress,
        audio: true,
        video: false,
        rootElement: document.body,
        userVariables: { t: prep.dialToken },
      });
      sessionRef.current = session;

      session.on('destroy', () => {
        setStatus({ kind: 'idle' });
        void cleanup();
      });

      await session.start();
      setStatus({ kind: 'in_call', startedAt: Date.now() });
      // Mark the notification handled so the popup doesn't re-fire.
      void markNotificationHandled({ notificationId: pending.notificationId });
      setPending(null);
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
      void cleanup();
    }
  }, [pending, cleanup]);

  const reject = useCallback(async () => {
    if (!pending) return;
    void markNotificationHandled({ notificationId: pending.notificationId });
    setPending(null);
  }, [pending]);

  const hangup = useCallback(async () => {
    await cleanup();
    setStatus({ kind: 'idle' });
  }, [cleanup]);

  return (
    <IncomingCallContext.Provider value={{ pending, status, answer, reject, hangup }}>
      {children}
    </IncomingCallContext.Provider>
  );
}
