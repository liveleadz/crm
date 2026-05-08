'use client';

// One SignalWire client per tab — owned and rotated here.
//
// Why this exists:
//   Until 0046 we had two independent SignalWire clients per tab
//   (IncomingCallProvider + OutgoingCallProvider). Both minted SATs for
//   the same subscriber `reference` (the user's email). Each rotation
//   on one side invalidated the other side's server-side authblock,
//   surfacing as `authblock_is_expired` 422s on the next dial. With a
//   single client there is exactly one authblock in play.
//
// Responsibilities:
//   - Mint + rotate the SAT (well under SignalWire's 2h TTL).
//   - Re-arm the inbound `online({ incomingCallHandlers })` registration
//     after every rotation so invites never silently stop arriving.
//   - Skip rotation while a call/invite is in flight (busy flag).
//   - Skip proactive rotation when the tab is hidden — keeps inactive
//     tabs from constantly stomping the active tab's authblock when
//     the same agent has multiple windows open.
//   - Provide `refreshNow()` so callers (the outbound dial path) can
//     react to a fresh `authblock_is_expired` error by atomically
//     swapping the client and retrying.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { SignalWire, type SignalWireClient } from '@signalwire/js';

// Re-arm interval. SignalWire's default SAT TTL is 2h; we rotate well
// under that so a tab that's been open for hours never trips the
// expiration on its next dial.
const CLIENT_REFRESH_MS = 30 * 60 * 1000;

// Loose shape — typed as `unknown` upstream to keep us decoupled from
// minor SDK type drift.
export type IncomingNotification = unknown;
export type IncomingHandler = (notification: IncomingNotification) => void;

type Ctx = {
  // Returns the current live client. If none exists yet, mints one.
  // Never returns a disconnected client — callers can hold the result
  // briefly without worrying about it being torn out from under them
  // (a rotation only swaps after the new client is fully ready).
  getClient: () => Promise<SignalWireClient>;
  // Force-mint a brand new client immediately. Called by the outbound
  // dial path when SignalWire returns `authblock_is_expired` so the
  // retry uses a guaranteed-fresh authblock.
  refreshNow: () => Promise<SignalWireClient>;
  // Both call providers report whether they're currently in a session
  // (invite popup, in-call, wrap-up). When ANY consumer is busy we
  // skip the scheduled rotation tick — tearing down a live client
  // mid-call would drop audio.
  setBusy: (key: string, busy: boolean) => void;
  // Register a handler for inbound invites. Re-attached automatically
  // on every rotation so the subscription survives token refresh.
  setIncomingHandler: (handler: IncomingHandler | null) => void;
};

const SignalWireClientContext = createContext<Ctx | null>(null);

export function useSignalWireClient(): Ctx {
  const ctx = useContext(SignalWireClientContext);
  if (!ctx) {
    throw new Error(
      'useSignalWireClient must be used inside SignalWireClientProvider',
    );
  }
  return ctx;
}

export function SignalWireClientProvider({ children }: { children: ReactNode }) {
  // Live client + a serial we bump on every rotation so callers that
  // captured an old reference can detect the swap.
  const clientRef = useRef<SignalWireClient | null>(null);
  // Promise of the in-flight mint, deduped so two concurrent
  // `getClient()` calls don't both POST to /api/signalwire/token.
  const pendingMintRef = useRef<Promise<SignalWireClient> | null>(null);
  const incomingHandlerRef = useRef<IncomingHandler | null>(null);
  // Multi-consumer busy registry. Each consumer (incoming / outgoing)
  // owns a key; rotation skips when ANY entry is true.
  const busyRef = useRef<Record<string, boolean>>({});
  // Re-render trigger so consumers using getClient() through React don't
  // hold a stale reference. We don't need to expose the client value
  // through context — getClient() always returns the current one.
  const [, forceRender] = useState(0);

  const isBusy = useCallback(() => {
    const b = busyRef.current;
    for (const key of Object.keys(b)) {
      if (b[key]) return true;
    }
    return false;
  }, []);

  // Build a brand-new client + arm the inbound handler. The previous
  // client is disconnected AFTER the new one is online so there's
  // never a window where a PSTN invite has nowhere to land.
  const mintFresh = useCallback(async (): Promise<SignalWireClient> => {
    const tokenRes = await fetch('/api/signalwire/token', {
      method: 'POST',
      cache: 'no-store',
    });
    if (!tokenRes.ok) {
      throw new Error(`Token fetch failed (${tokenRes.status})`);
    }
    const { token } = (await tokenRes.json()) as { token?: string };
    if (!token) throw new Error('SignalWire token route returned no token');

    const next = await SignalWire({ token });

    if (incomingHandlerRef.current) {
      const handler = incomingHandlerRef.current;
      try {
        await next.online({
          incomingCallHandlers: {
            all: ((notification: IncomingNotification) => {
              handler(notification);
            }) as never,
          },
        });
      } catch (e) {
        console.warn(
          '[signalwire-client] online() failed; inbound invites disabled until retry',
          (e as Error).message,
        );
      }
    }

    const prev = clientRef.current;
    clientRef.current = next;
    forceRender((n) => n + 1);

    if (prev) {
      void prev.disconnect().catch(() => undefined);
    }
    return next;
  }, []);

  const getClient = useCallback(async (): Promise<SignalWireClient> => {
    if (clientRef.current) return clientRef.current;
    if (pendingMintRef.current) return pendingMintRef.current;
    const p = mintFresh().finally(() => {
      pendingMintRef.current = null;
    });
    pendingMintRef.current = p;
    return p;
  }, [mintFresh]);

  const refreshNow = useCallback(async (): Promise<SignalWireClient> => {
    // De-dupe — if two callers refresh at once they share one mint.
    if (pendingMintRef.current) return pendingMintRef.current;
    const p = mintFresh().finally(() => {
      pendingMintRef.current = null;
    });
    pendingMintRef.current = p;
    return p;
  }, [mintFresh]);

  const setBusy = useCallback((key: string, busy: boolean) => {
    busyRef.current[key] = busy;
  }, []);

  const setIncomingHandler = useCallback(
    (handler: IncomingHandler | null) => {
      incomingHandlerRef.current = handler;
      // If a client already exists, re-arm online() against it so the
      // newly registered handler starts receiving invites without
      // waiting for the next rotation.
      const client = clientRef.current;
      if (!client) return;
      if (!handler) return;
      void (async () => {
        try {
          await client.online({
            incomingCallHandlers: {
              all: ((notification: IncomingNotification) => {
                handler(notification);
              }) as never,
            },
          });
        } catch (e) {
          console.warn(
            '[signalwire-client] re-arm online() failed',
            (e as Error).message,
          );
        }
      })();
    },
    [],
  );

  // Boot once on mount + schedule rotation. The rotation skips if the
  // tab is hidden (visibilityState === 'hidden') or any consumer is
  // busy. When the tab becomes visible again we attempt a one-shot
  // boot in case the inactive period killed our SAT.
  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (isBusy()) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      try {
        await mintFresh();
      } catch (e) {
        console.warn(
          '[signalwire-client] scheduled rotation failed',
          (e as Error).message,
        );
      }
    };

    // Initial mint — best-effort. Subscribers without an inbound
    // handler still benefit because outbound dials need a client too.
    void tick();

    const interval = window.setInterval(() => {
      void tick();
    }, CLIENT_REFRESH_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        // Don't immediately re-mint just because the tab came forward;
        // the SDK may still have a working session. But if we have no
        // client at all (initial mint failed), try again.
        if (!clientRef.current && !isBusy()) {
          void tick();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      const c = clientRef.current;
      clientRef.current = null;
      void c?.disconnect().catch(() => undefined);
    };
  }, [mintFresh, isBusy]);

  return (
    <SignalWireClientContext.Provider
      value={{ getClient, refreshNow, setBusy, setIncomingHandler }}
    >
      {children}
    </SignalWireClientContext.Provider>
  );
}
