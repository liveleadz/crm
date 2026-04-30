'use client';

// Topbar bell. Subscribes to a Supabase realtime channel on the
// `notifications` table for instant unread updates, plus a 90s poll as a
// fallback when the websocket is disconnected. Shows an unread badge and a
// dropdown with the latest 50. Clicking an item marks it read and
// (optionally) navigates to the linked URL.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@leadpilot/db/client';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/app/actions/notifications';

type Notif = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link_url: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationsBell() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/list', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as { items: Notif[]; unread: number };
      setItems(json.items ?? []);
      setUnread(json.unread ?? 0);
    } catch {
      /* offline / not signed in — silent */
    }
  }, []);

  useEffect(() => {
    refresh();
    // Fallback poll — realtime usually beats this, but if the websocket
    // drops (sleep, network blip) we still pick up changes within 90s.
    const t = setInterval(refresh, 90_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Realtime — any insert/update on `notifications` for the current
  // member triggers a refresh. RLS on the notifications table already
  // restricts what this client can see, so we don't need to filter
  // server-side; the channel only delivers rows the user can read.
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase
      .channel('notifications-bell')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        () => {
          void refresh();
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        () => {
          void refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  // Click outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function onItemClick(n: Notif) {
    if (!n.read_at) {
      // Optimistic.
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((u) => Math.max(0, u - 1));
      void markNotificationRead({ id: n.id });
    }
    if (n.link_url) {
      setOpen(false);
      window.location.href = n.link_url;
    }
  }

  async function onMarkAllRead() {
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
    await markAllNotificationsRead();
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-txt-2 hover:border-line-2 hover:text-txt-1"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-hp px-1 text-[9.5px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[42px] z-40 w-[340px] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[12px] font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="text-[11px] text-teal hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-txt-3">
                Nothing here yet.
              </div>
            ) : (
              items.slice(0, 20).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={`flex w-full flex-col items-start border-b border-line px-3 py-2 text-left hover:bg-canvas ${
                    n.read_at ? 'opacity-70' : ''
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-[12.5px] font-medium">{n.title}</span>
                    <span className="text-[10.5px] text-txt-3">{formatRelative(n.created_at)}</span>
                  </div>
                  {n.body && <span className="mt-0.5 text-[11.5px] text-txt-2">{n.body}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
