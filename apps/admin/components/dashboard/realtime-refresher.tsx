'use client';

// Mounts a Supabase realtime channel that refreshes the server-rendered
// dashboard whenever calls / leads / appointments change. RLS already
// scopes the subscription to the active brand, so we don't filter
// client-side. Multiple concurrent events are coalesced into a single
// router.refresh() via a 1.5s trailing debounce — KPI cards re-fetch
// on the next paint without spamming the server.

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@leadpilot/db/client';

export function DashboardRealtimeRefresher() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();

    function scheduleRefresh() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        router.refresh();
      }, 1500);
    }

    const channel = supabase
      .channel('dashboard-kpis')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, scheduleRefresh)
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
