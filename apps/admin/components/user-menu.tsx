'use client';

import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/app/actions/auth';

export function UserMenu({ email, fullName }: { email: string; fullName: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const display = fullName?.trim() || email;
  const initials =
    (fullName?.trim() || email)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]!.toUpperCase())
      .join('') || '?';

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        className="flex h-9 items-center gap-2 rounded-lg pl-1 pr-3 hover:bg-surface-2"
      >
        <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-teal to-bs text-[11px] font-semibold text-white">
          {initials}
        </div>
        <div className="text-left leading-tight">
          <div className="text-[12px] font-medium">{display}</div>
          <div className="text-[10.5px] text-txt-3">Owner</div>
        </div>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 min-w-[220px] rounded-xl border border-line bg-surface p-1 shadow-lg">
          <div className="px-3 py-2 text-[11px] text-txt-3">{email}</div>
          <form action={signOut}>
            <button
              type="submit"
              className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-[12.5px] text-red-400 hover:bg-surface-2"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
