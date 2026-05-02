'use client';

// Brand-wide attempt cap. The dial-queue loader and prepareCall both
// honor this — it's not a soft hint. Empty input = no cap (legacy).

import { useState, useTransition } from 'react';
import { setBrandDialCap } from '@/app/actions/brand-dial-policy';

export function BrandDialPolicy({ initialCap }: { initialCap: number | null }) {
  const [value, setValue] = useState<string>(initialCap?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [savedCap, setSavedCap] = useState<number | null>(initialCap);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const trimmed = value.trim();
    const parsed = trimmed === '' ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1 || parsed > 100)) {
      setError('Cap must be 1–100, or empty for no cap.');
      return;
    }
    if (parsed === savedCap) return;
    startTransition(async () => {
      const res = await setBrandDialCap({ maxPerDay: parsed });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedCap(parsed);
    });
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3">
        <label className="flex items-center gap-2 text-[12.5px]">
          <span className="text-txt-2">Max calls per lead per day</span>
          <input
            type="number"
            min={1}
            max={100}
            step={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
            }}
            placeholder="No cap"
            className="w-20 rounded-md border border-line bg-canvas px-2 py-1 text-right text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
        </label>
        <span className="text-[11.5px] text-txt-3">
          {pending
            ? 'Saving…'
            : savedCap
              ? `Active — leads with ${savedCap} call${savedCap === 1 ? '' : 's'} today are skipped.`
              : 'No cap configured. Cooldowns still apply per-disposition.'}
        </span>
      </div>
    </div>
  );
}
