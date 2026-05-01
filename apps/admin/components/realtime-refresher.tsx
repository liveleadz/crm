'use client';

// Generic realtime → router.refresh() bridge. Mounts a Supabase channel on
// `tables` and triggers a debounced server-component refetch whenever any
// row in those tables changes. RLS scopes the events to the current
// brand/user, so we don't filter client-side.
//
// Usage: <RealtimeRefresher channel="leads-table" tables={['leads']} />
// The `channel` name must be unique per mounted instance to avoid
// collisions with other live channels (notifications-bell, etc.).

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@leadpilot/db/client';

export function RealtimeRefresher({
  channel,
  tables,
  debounceMs = 1500,
}: {
  channel: string;
  tables: readonly string[];
  debounceMs?: number;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tablesRef = useRef(tables);
  tablesRef.current = tables;

  useEffect(() => {
    const supabase = createBrowserClient();

    function scheduleRefresh() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        router.refresh();
      }, debounceMs);
    }

    let ch = supabase.channel(channel);
    for (const table of tablesRef.current) {
      ch = ch.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        scheduleRefresh,
      );
    }
    ch.subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(ch);
    };
  }, [router, channel, debounceMs]);

  return null;
}
