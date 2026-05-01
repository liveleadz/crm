'use client';

// Tiny polling hook that only ticks while the tab is visible. Skips work
// on backgrounded tabs to avoid burning API quota for a user who isn't
// looking. Used by the conversations view to refresh the active thread
// in near-real-time without setting up GCP Pub/Sub.

import { useEffect, useRef } from 'react';

export function useVisiblePoll(callback: () => void | Promise<void>, intervalMs: number) {
  // Stash the latest callback in a ref so we don't restart the interval
  // every time the parent rerenders with a new closure.
  const cbRef = useRef(callback);
  useEffect(() => {
    cbRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (intervalMs <= 0) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (timer !== null) return;
      timer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        void cbRef.current();
      }, intervalMs);
    }
    function stop() {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') {
        // Fire once immediately when coming back into focus so the user
        // sees fresh data without waiting a full interval.
        void cbRef.current();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [intervalMs]);
}
