'use client';

import { useState, useRef, useEffect, useTransition } from 'react';
import { setActiveBrand } from '@/app/actions/brand';
import type { ActiveBrand } from '@/lib/active-brand';

const DOT_COLOR: Record<string, string> = {
  hp: 'bg-hp',
  vl: 'bg-vl',
  bs: 'bg-bs',
  ll: 'bg-ll',
  hb: 'bg-hb',
  bi: 'bg-bi',
};

export function BrandSwitcher({ brands, active }: { brands: ActiveBrand[]; active: ActiveBrand }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function pick(id: string) {
    setOpen(false);
    startTransition(() => setActiveBrand(id));
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        disabled={pending}
        className="flex h-8 items-center gap-2 rounded-lg border border-line px-3 hover:bg-surface-2 disabled:opacity-60"
      >
        <span className={`h-2 w-2 rounded-full ${DOT_COLOR[active.id] ?? 'bg-txt-3'}`} />
        <span className="text-[13px] font-medium">{active.name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-3">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-40 min-w-[220px] rounded-xl border border-line bg-surface p-1 shadow-lg">
          {brands.map((b) => (
            <button
              key={b.id}
              onClick={() => pick(b.id)}
              className="flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[12.5px] hover:bg-surface-2"
            >
              <span className={`h-2 w-2 rounded-full ${DOT_COLOR[b.id] ?? 'bg-txt-3'}`} />
              <span>{b.name}</span>
              {b.id === active.id && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="ml-auto text-teal">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
