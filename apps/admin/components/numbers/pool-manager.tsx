'use client';

// Outbound caller-ID pools: list of pools for the active brand, an
// editor to flip strategy + member set, and a "default pool" toggle that
// routes plain manual dials (no campaign) through the picker.

import { useMemo, useState, useTransition } from 'react';
import {
  createPool,
  deletePool,
  setBrandDefaultPool,
  setPoolMembers,
  updatePool,
} from '@/app/actions/phone-pools';
import type { PhonePool, PhonePoolMember, PoolStrategy } from '@/lib/phone-pools';

type Props = {
  pools: (PhonePool & { members: PhonePoolMember[] })[];
  numbers: { id: string; e164: string; label: string | null; active: boolean }[];
  defaultPoolId: string | null;
};

const STRATEGY_LABELS: Record<PoolStrategy, string> = {
  round_robin: 'Round-robin',
  random: 'Weighted random',
  sticky_lead: 'Sticky per lead',
};

export function PoolManager({ pools: initial, numbers, defaultPoolId }: Props) {
  const [pools, setPools] = useState(initial);
  const [defaultId, setDefaultId] = useState(defaultPoolId);
  const [editing, setEditing] = useState<string | null>(null);
  const [creatingName, setCreatingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const numberById = useMemo(() => new Map(numbers.map((n) => [n.id, n])), [numbers]);

  function onCreate() {
    const name = creatingName.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const res = await createPool({ name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPools((prev) => [
        ...prev,
        {
          id: res.poolId,
          brandId: '',
          name,
          strategy: 'round_robin',
          numberCount: 0,
          members: [],
        },
      ]);
      setCreatingName('');
    });
  }

  function onChangeStrategy(poolId: string, strategy: PoolStrategy) {
    setPools((prev) => prev.map((p) => (p.id === poolId ? { ...p, strategy } : p)));
    startTransition(async () => {
      const res = await updatePool({ poolId, strategy });
      if (!res.ok) setError(res.error);
    });
  }

  function onRename(poolId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setPools((prev) => prev.map((p) => (p.id === poolId ? { ...p, name: trimmed } : p)));
    startTransition(async () => {
      const res = await updatePool({ poolId, name: trimmed });
      if (!res.ok) setError(res.error);
    });
  }

  function onDelete(poolId: string) {
    if (!window.confirm('Delete this pool? Campaigns using it will fall back to the brand default.')) return;
    startTransition(async () => {
      const res = await deletePool(poolId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPools((prev) => prev.filter((p) => p.id !== poolId));
      if (defaultId === poolId) setDefaultId(null);
    });
  }

  function onToggleMember(poolId: string, numberId: string) {
    setPools((prev) =>
      prev.map((p) => {
        if (p.id !== poolId) return p;
        const has = p.members.some((m) => m.numberId === numberId);
        const num = numberById.get(numberId);
        if (!num) return p;
        const members = has
          ? p.members.filter((m) => m.numberId !== numberId)
          : [
              ...p.members,
              {
                numberId,
                e164: num.e164,
                label: num.label,
                active: num.active,
                weight: 1,
                lastUsedAt: null,
              },
            ];
        return { ...p, members, numberCount: members.length };
      }),
    );
    // Resolve the new id list against the freshly computed state by
    // recomputing inline (state update above is async).
    const pool = pools.find((p) => p.id === poolId);
    if (!pool) return;
    const has = pool.members.some((m) => m.numberId === numberId);
    const nextIds = has
      ? pool.members.filter((m) => m.numberId !== numberId).map((m) => m.numberId)
      : [...pool.members.map((m) => m.numberId), numberId];
    startTransition(async () => {
      const res = await setPoolMembers({ poolId, numberIds: nextIds });
      if (!res.ok) setError(res.error);
    });
  }

  function onSetDefault(poolId: string | null) {
    setDefaultId(poolId);
    startTransition(async () => {
      const res = await setBrandDefaultPool(poolId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-txt-1">Caller-ID pools</h2>
          <p className="text-[12px] text-txt-3">
            Rotate outbound numbers across a campaign or brand-wide. Falls back to the
            oldest active number when no pool is configured.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={creatingName}
            onChange={(e) => setCreatingName(e.target.value)}
            placeholder="New pool name"
            className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12px] text-txt-1 outline-none focus:border-teal/40"
          />
          <button
            type="button"
            onClick={onCreate}
            disabled={pending || !creatingName.trim()}
            className="rounded-md border border-line bg-canvas px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:border-teal/40 hover:text-teal disabled:opacity-50"
          >
            Add pool
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-500">
          {error}
        </div>
      )}

      {pools.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-2 bg-canvas/40 p-6 text-center text-[12px] text-txt-3">
          No pools yet. Create one above to enable rotation.
        </div>
      ) : (
        <div className="space-y-3">
          {pools.map((pool) => {
            const isOpen = editing === pool.id;
            const isDefault = defaultId === pool.id;
            const memberIds = new Set(pool.members.map((m) => m.numberId));
            return (
              <div
                key={pool.id}
                className="rounded-lg border border-line bg-canvas/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-1 items-center gap-2">
                    <input
                      type="text"
                      defaultValue={pool.name}
                      onBlur={(e) => onRename(pool.id, e.target.value)}
                      className="rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-semibold text-txt-1 outline-none hover:border-line focus:border-teal/40"
                    />
                    <span className="rounded-full border border-line px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-txt-3">
                      {pool.numberCount} number{pool.numberCount === 1 ? '' : 's'}
                    </span>
                    {isDefault && (
                      <span className="rounded-full bg-teal/15 px-2 py-0.5 text-[10.5px] font-medium text-teal">
                        Brand default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={pool.strategy}
                      onChange={(e) =>
                        onChangeStrategy(pool.id, e.target.value as PoolStrategy)
                      }
                      className="rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-txt-1 outline-none focus:border-teal/40"
                    >
                      {(Object.keys(STRATEGY_LABELS) as PoolStrategy[]).map((s) => (
                        <option key={s} value={s}>
                          {STRATEGY_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => onSetDefault(isDefault ? null : pool.id)}
                      disabled={pending}
                      className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] text-txt-2 hover:border-teal/40 hover:text-teal disabled:opacity-50"
                    >
                      {isDefault ? 'Unset default' : 'Set default'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(isOpen ? null : pool.id)}
                      className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] text-txt-2 hover:border-line-2"
                    >
                      {isOpen ? 'Close' : 'Members'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(pool.id)}
                      disabled={pending}
                      className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] text-txt-3 hover:border-rose-500/40 hover:text-rose-500 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-3 grid gap-1.5 border-t border-line pt-3">
                    {numbers.length === 0 ? (
                      <span className="text-[12px] text-txt-3">
                        No numbers in this brand yet.
                      </span>
                    ) : (
                      numbers.map((n) => {
                        const checked = memberIds.has(n.id);
                        return (
                          <label
                            key={n.id}
                            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12px] hover:bg-canvas"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggleMember(pool.id, n.id)}
                              disabled={!n.active && !checked}
                              className="size-3.5 rounded border border-line"
                            />
                            <span className="font-mono text-txt-2">{n.e164}</span>
                            {n.label && (
                              <span className="text-txt-3">· {n.label}</span>
                            )}
                            {!n.active && (
                              <span className="ml-auto rounded-full border border-line px-1.5 py-0.5 text-[10px] uppercase text-txt-3">
                                Inactive
                              </span>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
