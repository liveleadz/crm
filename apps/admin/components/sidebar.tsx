'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import type { MemberRole } from '@/lib/team';

type NavItem = { href: Route; label: string; icon: ReactNode; badge?: ReactNode };

const ICON = (path: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    {path}
  </svg>
);

const WORKSPACE: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Dashboard',
    icon: ICON(
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>,
    ),
  },
  {
    href: '/leads',
    label: 'Leads',
    icon: ICON(
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>,
    ),
  },
  {
    href: '/calls',
    label: 'Calls',
    icon: ICON(
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />,
    ),
  },
  {
    href: '/dialer',
    label: 'Dialer',
    icon: ICON(
      <>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" />
      </>,
    ),
    badge: (
      <span className="ml-auto inline-flex h-[22px] items-center rounded-full bg-ll/15 px-2 text-[11.5px] font-medium text-ll">
        Live
      </span>
    ),
  },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: ICON(
      <>
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </>,
    ),
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: ICON(
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>,
    ),
  },
  {
    href: '/messages',
    label: 'Messages',
    icon: ICON(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />),
  },
  {
    href: '/workflows',
    label: 'Automations',
    icon: ICON(
      <>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </>,
    ),
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: ICON(
      <>
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
      </>,
    ),
  },
];

const MANAGEMENT: NavItem[] = [
  {
    href: '/team',
    label: 'Team & Assignments',
    icon: ICON(
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>,
    ),
  },
  {
    href: '/scripts',
    label: 'Scripts & Templates',
    icon: ICON(
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M16 13H8M16 17H8" />
      </>,
    ),
  },
  {
    href: '/numbers',
    label: 'Numbers & Routing',
    icon: ICON(
      <>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <line x1="12" y1="18" x2="12.01" y2="18" />
      </>,
    ),
  },
];

const FOOTER: NavItem[] = [
  {
    href: '/settings',
    label: 'Settings',
    icon: ICON(
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </>,
    ),
  },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={`flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ${
        active
          ? 'bg-teal/10 font-medium text-teal'
          : 'text-txt-2 hover:bg-surface-2'
      }`}
    >
      {item.icon}
      <span>{item.label}</span>
      {item.badge}
    </Link>
  );
}

function canSeeManagement(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export function Sidebar({ role }: { role: MemberRole | null }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const showManagement = canSeeManagement(role);

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-surface">
      <nav className="flex-1 space-y-0.5 overflow-auto p-3 text-[13px]">
        <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-txt-3">
          Workspace
        </div>
        {WORKSPACE.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
        {showManagement && (
          <>
            <div className="px-2 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-wider text-txt-3">
              Management
            </div>
            {MANAGEMENT.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </>
        )}
      </nav>
      <div className="space-y-0.5 border-t border-line p-3">
        {FOOTER.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </div>
    </aside>
  );
}
