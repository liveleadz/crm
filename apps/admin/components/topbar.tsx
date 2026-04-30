import { BrandSwitcher } from './brand-switcher';
import { NotificationsBell } from './notifications-bell';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import type { ActiveBrand } from '@/lib/active-brand';

export function Topbar({
  brands,
  active,
  email,
  fullName,
}: {
  brands: ActiveBrand[];
  active: ActiveBrand;
  email: string;
  fullName: string | null;
}) {
  return (
    <header className="z-30 flex h-14 shrink-0 items-center border-b border-line bg-surface px-5">
      <div className="mr-4 flex h-8 items-center gap-2 border-r border-line pr-4">
        <div className="grid h-7 w-7 place-items-center rounded-lg bg-teal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="m3 11 18-5v12L3 13v-2z" />
          </svg>
        </div>
        <span className="text-[14px] font-semibold tracking-tight">LeadPilot</span>
      </div>

      <BrandSwitcher brands={brands} active={active} />

      <div className="flex flex-1 justify-center">
        <button
          type="button"
          className="flex h-9 w-[420px] items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 text-txt-3 hover:border-line-2"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <span className="text-[12.5px]">Search leads, calls, messages…</span>
          <span className="ml-auto rounded-md border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px]">⌘K</span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <NotificationsBell />
        <ThemeToggle />
        <UserMenu email={email} fullName={fullName} />
      </div>
    </header>
  );
}
