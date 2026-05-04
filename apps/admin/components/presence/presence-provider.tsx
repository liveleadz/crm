'use client';

// Phase N: client-side presence tracker.
//
// Two jobs:
// 1. **Local status machine** — derive on_call / active / idle / offline
//    from user activity events (mousemove/keydown/click, throttled), the
//    page visibility API, and the dialer's `setOnCall` signal exposed via
//    context. Idle = no activity for 5 minutes. Offline = tab hidden for
//    >60s (we untrack from the realtime channel; the table-side ping
//    flips the row to 'offline' too).
// 2. **Server mirror** — call the `pingPresence` server action once per
//    minute (or immediately on a status transition) so server components
//    can read the latest snapshot and accumulate seconds_today.
//
// The provider also exposes `setOnCall(true|false)` for the dialer to
// pin status to on_call while a call is in progress.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { pingPresence } from '@/app/actions/presence';

type PresenceStatus = 'on_call' | 'active' | 'idle' | 'offline';

type PresenceContextValue = {
  status: PresenceStatus;
  setOnCall: (on: boolean) => void;
};

const PresenceContext = createContext<PresenceContextValue>({
  status: 'active',
  setOnCall: () => {},
});

export function usePresence(): PresenceContextValue {
  return useContext(PresenceContext);
}

const IDLE_MS = 5 * 60 * 1000;
const HIDDEN_OFFLINE_MS = 60 * 1000;
const PING_INTERVAL_MS = 60 * 1000;
// Throttle activity events so we don't flood `lastEventAt` updates.
const ACTIVITY_THROTTLE_MS = 30 * 1000;

export function PresenceProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<PresenceStatus>('active');
  const onCallRef = useRef(false);
  const lastActivityRef = useRef<number>(Date.now());
  const lastActivityRecordedRef = useRef<number>(0);
  const hiddenSinceRef = useRef<number | null>(null);
  const lastSentStatusRef = useRef<PresenceStatus | null>(null);
  const lastPingAtRef = useRef<number>(0);

  // Compute the status that should be reported right now from refs.
  const computeStatus = useCallback((): PresenceStatus => {
    if (onCallRef.current) return 'on_call';
    if (
      hiddenSinceRef.current !== null &&
      Date.now() - hiddenSinceRef.current > HIDDEN_OFFLINE_MS
    ) {
      return 'offline';
    }
    if (Date.now() - lastActivityRef.current > IDLE_MS) return 'idle';
    return 'active';
  }, []);

  // Send the current status to the server. Skips if status is unchanged
  // and the last ping was less than PING_INTERVAL_MS ago (the heartbeat
  // schedules its own pings).
  const send = useCallback(
    async (force = false) => {
      const next = computeStatus();
      const now = Date.now();
      const elapsed = now - lastPingAtRef.current;
      if (!force && next === lastSentStatusRef.current && elapsed < PING_INTERVAL_MS) {
        return;
      }
      lastSentStatusRef.current = next;
      lastPingAtRef.current = now;
      setStatus(next);
      try {
        await pingPresence({ status: next });
      } catch {
        // Network blip — the next heartbeat will retry. Don't surface
        // this; presence is best-effort.
      }
    },
    [computeStatus],
  );

  const setOnCall = useCallback(
    (on: boolean) => {
      onCallRef.current = on;
      // Force-send so the on_call transition is instant for managers
      // watching the live floor.
      void send(true);
    },
    [send],
  );

  useEffect(() => {
    function bumpActivity() {
      lastActivityRef.current = Date.now();
      // Throttle the server ping so micro-movements don't generate
      // hundreds of round-trips per session.
      if (Date.now() - lastActivityRecordedRef.current > ACTIVITY_THROTTLE_MS) {
        lastActivityRecordedRef.current = Date.now();
        void send();
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
      } else {
        hiddenSinceRef.current = null;
        lastActivityRef.current = Date.now();
        void send(true);
      }
    }
    function onBeforeUnload() {
      // Best-effort offline mark. The RPC isn't guaranteed to flush
      // before the tab closes, but the stale-row check on the server
      // side flips us to 'offline' within ~3 min anyway.
      void pingPresence({ status: 'offline' });
    }

    const events: (keyof DocumentEventMap)[] = ['mousemove', 'keydown', 'click', 'scroll'];
    for (const e of events) document.addEventListener(e, bumpActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);

    // Initial ping + heartbeat tick.
    void send(true);
    const tick = setInterval(() => void send(), 30 * 1000);

    return () => {
      for (const e of events) document.removeEventListener(e, bumpActivity);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      clearInterval(tick);
    };
  }, [send]);

  return (
    <PresenceContext.Provider value={{ status, setOnCall }}>{children}</PresenceContext.Provider>
  );
}
