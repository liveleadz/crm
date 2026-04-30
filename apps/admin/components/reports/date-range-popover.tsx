'use client';

// Compact date-range picker for the Reports filter bar. Click the
// trigger button to open a one-month calendar; click a day to set the
// start, click a second day to set the end (clicks before the start
// are treated as a new start). Closes when both ends are set or the
// user clicks outside. No external date library — month math is naive
// UTC, which is plenty for a "calendar grid" widget.

import { useEffect, useMemo, useRef, useState } from 'react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parseIso(s: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { y, m: m - 1, d };
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatLabel(iso: string): string {
  const p = parseIso(iso);
  if (!p) return iso;
  return `${SHORT_MONTHS[p.m]} ${p.d}, ${p.y}`;
}

export function DateRangePopover({
  fromIso: fromProp,
  toIso: toProp,
  onChange,
}: {
  fromIso: string;
  toIso: string;
  onChange: (next: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  // Local pending selection while user is mid-pick (one end clicked, waiting
  // for the second). Committed back via onChange when both ends set.
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const todayParts = useMemo(() => {
    const t = new Date();
    return { y: t.getFullYear(), m: t.getMonth() };
  }, []);
  const initial = parseIso(fromProp) ?? parseIso(toProp);
  const [view, setView] = useState({
    y: initial?.y ?? todayParts.y,
    m: initial?.m ?? todayParts.m,
  });
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!popRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setPendingFrom(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setPendingFrom(null);
      }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pickDay(iso: string) {
    if (!pendingFrom) {
      setPendingFrom(iso);
      return;
    }
    const [from, to] = compareIso(iso, pendingFrom) < 0
      ? [iso, pendingFrom]
      : [pendingFrom, iso];
    onChange({ from, to });
    setPendingFrom(null);
    setOpen(false);
  }

  function shiftMonth(delta: number) {
    setView((v) => {
      const next = v.m + delta;
      if (next < 0) return { y: v.y - 1, m: 11 };
      if (next > 11) return { y: v.y + 1, m: 0 };
      return { y: v.y, m: next };
    });
  }

  // Quick presets — one click sets common ranges. All windows are
  // inclusive of today as the end date.
  const PRESETS: { label: string; build: () => { from: string; to: string } }[] = [
    {
      label: '7d',
      build: () => {
        const t = new Date();
        const f = new Date(t.getTime() - 6 * 86_400_000);
        return {
          from: toIso(f.getFullYear(), f.getMonth(), f.getDate()),
          to: toIso(t.getFullYear(), t.getMonth(), t.getDate()),
        };
      },
    },
    {
      label: 'MTD',
      build: () => {
        const t = new Date();
        return {
          from: toIso(t.getFullYear(), t.getMonth(), 1),
          to: toIso(t.getFullYear(), t.getMonth(), t.getDate()),
        };
      },
    },
    {
      label: 'QTD',
      build: () => {
        const t = new Date();
        const qm = Math.floor(t.getMonth() / 3) * 3;
        return {
          from: toIso(t.getFullYear(), qm, 1),
          to: toIso(t.getFullYear(), t.getMonth(), t.getDate()),
        };
      },
    },
    {
      label: 'YTD',
      build: () => {
        const t = new Date();
        return {
          from: toIso(t.getFullYear(), 0, 1),
          to: toIso(t.getFullYear(), t.getMonth(), t.getDate()),
        };
      },
    },
  ];

  function applyPreset(p: (typeof PRESETS)[number]) {
    const next = p.build();
    onChange(next);
    setPendingFrom(null);
    setOpen(false);
  }

  // Build the 6×7 grid for the current view month.
  const cells = useMemo(() => {
    const firstDow = new Date(view.y, view.m, 1).getDay();
    const dim = daysInMonth(view.y, view.m);
    const out: (string | null)[] = [];
    for (let i = 0; i < firstDow; i += 1) out.push(null);
    for (let d = 1; d <= dim; d += 1) out.push(toIso(view.y, view.m, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const lo = pendingFrom ?? fromProp;
  const hi = pendingFrom ? null : toProp;
  const triggerLabel =
    fromProp && toProp
      ? `${formatLabel(fromProp)} → ${formatLabel(toProp)}`
      : 'Pick range';

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-line bg-canvas px-2.5 py-1 text-[12px] text-txt-2 hover:border-teal/40"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-txt-3">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className="tabular-nums">{triggerLabel}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[260px] rounded-xl border border-line bg-surface p-3 shadow-lg">
          <div className="mb-2 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className="rounded-md border border-line bg-canvas px-2 py-0.5 text-[10.5px] font-medium text-txt-2 hover:border-teal/40 hover:text-teal"
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="rounded-md p-1 text-txt-3 hover:bg-canvas"
              aria-label="Previous month"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="text-[12.5px] font-semibold text-txt-1">
              {MONTHS[view.m]} {view.y}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded-md p-1 text-txt-3 hover:bg-canvas"
              aria-label="Next month"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-txt-3">
            {WEEKDAYS.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((iso, i) => {
              if (!iso) return <span key={i} />;
              const isStart = iso === lo;
              const isEnd = !!hi && iso === hi;
              const inRange =
                !!hi && compareIso(iso, lo) > 0 && compareIso(iso, hi) < 0;
              const cls = isStart || isEnd
                ? 'bg-teal text-white font-semibold'
                : inRange
                  ? 'bg-teal/15 text-txt-1'
                  : 'text-txt-2 hover:bg-canvas';
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickDay(iso)}
                  className={`h-7 rounded-md text-[11.5px] tabular-nums ${cls}`}
                >
                  {parseIso(iso)?.d}
                </button>
              );
            })}
          </div>
          {pendingFrom && (
            <p className="mt-2 text-[10.5px] text-txt-3">
              Pick the end date · start: {formatLabel(pendingFrom)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
