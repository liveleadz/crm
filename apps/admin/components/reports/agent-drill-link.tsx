'use client';

// Drill-down link inside the per-agent table. Clicking an agent's name
// sets `?agent=<id>` while preserving range/dir/from/to. Clicking the
// active agent again (or the "Clear filter" pill) drops the param.

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useSearchParams } from 'next/navigation';

export function AgentDrillLink({
  agentId,
  className,
  children,
}: {
  agentId: string | null;
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const next = new URLSearchParams(params.toString());
  if (agentId) next.set('agent', agentId);
  else next.delete('agent');
  const qs = next.toString();
  const href = (qs ? `${pathname}?${qs}` : pathname) as Route;
  return (
    <Link href={href} className={className} scroll={false}>
      {children}
    </Link>
  );
}
