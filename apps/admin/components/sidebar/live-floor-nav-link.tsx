'use client';

// Phase O: sidebar nav link for the manager-only Live Floor.
// Mirrors the visual language of the other NavLink rows but adds a
// red pulse dot when there are calls in progress right now. The dot
// is driven by a tiny postgres_changes subscription on `calls` filtered
// to `ended_at is null` for this brand. We re-count on every delta and
// also tick once a minute as a backstop.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { createBrowserClient } from '@leadpilot/db/client';

export function LiveFloorNavLink({ brandId }: { brandId: string }) {
  const pathname = usePathname();
  const href = '/live' as Route;
  const active = pathname === href || pathname.startsWith(href + '/');
  const [count, setCount] = useState(0);

  useEffect(() => {
    const supabase = createBrowserClient();
    let mounted = true;

    async function refresh() {
      const { count: c } = await supabase
        .from('calls')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId)
        .is('ended_at', null);
      if (!mounted) return;
      setCount(c ?? 0);
    }

    void refresh();
    const tick = setInterval(refresh, 60 * 1000);

    const channel = supabase
      .channel(`live-floor-nav:${brandId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'calls', filter: `brand_id=eq.${brandId}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      mounted = false;
      clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [brandId]);

  return (
    <Link
      href={href}
      className={`flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ${
        active ? 'bg-teal/10 font-medium text-teal' : 'text-txt-2 hover:bg-surface-2'
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
      <span>Live floor</span>
      <span className="ml-auto flex items-center">
        {count > 0 ? (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hp opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-hp" />
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-line" />
        )}
      </span>
    </Link>
  );
}
