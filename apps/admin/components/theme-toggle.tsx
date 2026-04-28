'use client';

import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const saved = (localStorage.getItem('lp_theme') as 'light' | 'dark' | null) ?? 'dark';
    setTheme(saved);
    document.documentElement.dataset.theme = saved;
  }, []);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('lp_theme', next);
    document.documentElement.dataset.theme = next;
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="relative h-7 w-[52px] rounded-full border border-line bg-surface-2 transition-colors"
    >
      <span
        className="absolute top-[2px] grid h-[22px] w-[22px] place-items-center rounded-full bg-surface shadow-sm transition-transform"
        style={{ transform: theme === 'dark' ? 'translateX(24px)' : 'translateX(2px)' }}
      >
        {theme === 'dark' ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#E5E7EB" strokeWidth="2.5">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        )}
      </span>
    </button>
  );
}
