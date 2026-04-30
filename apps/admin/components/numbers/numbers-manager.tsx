'use client';

// Numbers & Routing manager. Lists every phone number bound to the active
// brand with a small health summary (call/SMS volume + success rate over the
// last 7d), an editable label, an A2P campaign id field, and an active
// toggle. Admins can also pull fresh numbers from SignalWire on demand.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  bulkDeleteNumbers,
  deleteNumber,
  setA2pCampaignId,
  setNumberActive,
  syncSignalWireNumbers,
  updateNumberLabel,
} from '@/app/actions/numbers';
import type { NumberWithHealth } from '@/lib/numbers';

type Props = {
  initial: NumberWithHealth[];
  swReady: boolean;
};

export function NumbersManager({ initial, swReady }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<NumberWithHealth[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function patch(id: string, fn: (n: NumberWithHealth) => NumberWithHealth) {
    setItems((prev) => prev.map((n) => (n.id === id ? fn(n) : n)));
  }

  async function onSync() {
    if (!swReady) {
      setError(
        'SignalWire credentials missing on the server. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, and SIGNALWIRE_SPACE_URL.',
      );
      return;
    }
    setError(null);
    setInfo(null);
    setSyncing(true);
    const res = await syncSignalWireNumbers();
    setSyncing(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setInfo(
      res.added > 0 || res.updated > 0
        ? `Synced ${res.total} number${res.total === 1 ? '' : 's'} — ${res.added} added, ${res.updated} updated.`
        : `Already in sync (${res.total} number${res.total === 1 ? '' : 's'} on SignalWire).`,
    );
    // Re-fetch the server data so the new rows show up with health attached.
    router.refresh();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function selectAll() {
    setSelected(new Set(items.map((n) => n.id)));
  }

  async function onDelete(id: string) {
    if (!window.confirm('Remove this number from the brand? This cannot be undone.')) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteNumber({ id });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((n) => n.id !== id));
    });
  }

  async function onBulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Remove ${ids.length} number${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await bulkDeleteNumbers({ ids });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setItems((prev) => prev.filter((n) => !selected.has(n.id)));
      clearSelection();
    });
  }

  async function onActiveToggle(n: NumberWithHealth, next: boolean) {
    patch(n.id, (x) => ({ ...x, active: next }));
    startTransition(async () => {
      const res = await setNumberActive({ id: n.id, active: next });
      if (!res.ok) {
        // Revert on failure
        patch(n.id, (x) => ({ ...x, active: !next }));
        setError(res.error);
      }
    });
  }

  async function onLabelCommit(n: NumberWithHealth, label: string) {
    if ((n.label ?? '') === label) return;
    patch(n.id, (x) => ({ ...x, label }));
    startTransition(async () => {
      const res = await updateNumberLabel({ id: n.id, label });
      if (!res.ok) setError(res.error);
    });
  }

  async function onA2pCommit(n: NumberWithHealth, value: string) {
    if ((n.a2pCampaignId ?? '') === value) return;
    patch(n.id, (x) => ({ ...x, a2pCampaignId: value || null }));
    startTransition(async () => {
      const res = await setA2pCampaignId({ id: n.id, campaignId: value });
      if (!res.ok) setError(res.error);
    });
  }

  const totalCalls = items.reduce((s, n) => s + n.health.callsLast7d, 0);
  const totalSms = items.reduce((s, n) => s + n.health.smsLast7d, 0);
  const overallRate =
    totalCalls > 0
      ? items.reduce((s, n) => s + n.health.callsConnectedLast7d, 0) / totalCalls
      : 0;

  return (
    <div className="space-y-4 p-6">
      {/* Health summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Numbers" value={items.length.toString()} />
        <Stat label="Active" value={items.filter((n) => n.active).length.toString()} />
        <Stat label="Calls (7d)" value={totalCalls.toString()} />
        <Stat
          label="Connect rate"
          value={totalCalls > 0 ? `${Math.round(overallRate * 100)}%` : '—'}
          sub={`${totalSms} SMS in last 7d`}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12.5px] text-txt-3">
          Pull numbers you bought in SignalWire into this brand and set how they’re used.
        </div>
        <button
          type="button"
          disabled={syncing}
          onClick={onSync}
          className="inline-flex items-center gap-2 rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {syncing ? (
            <>
              <Spinner /> Syncing…
            </>
          ) : (
            <>Sync from SignalWire</>
          )}
        </button>
      </div>

      {!swReady && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-400">
          SignalWire credentials are not configured on the server, so syncing is disabled. Set
          SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, and SIGNALWIRE_SPACE_URL in Vercel to enable
          it.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-400">
          {info}
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-teal/40 bg-teal/5 px-3 py-2 text-[12px]">
          <span className="font-medium text-txt-1">{selected.size} selected</span>
          <span className="mx-1 h-4 w-px bg-line" />
          <button
            type="button"
            onClick={onBulkDelete}
            className="rounded-md border border-hp/40 bg-hp/10 px-2.5 py-1 text-[11.5px] text-hp hover:bg-hp/20"
          >
            Remove
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto rounded-md px-2 py-1 text-[11.5px] text-txt-3 hover:text-txt-1"
          >
            Clear
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        {items.length === 0 ? (
          <div className="px-4 py-12 text-center text-[12.5px] text-txt-3">
            No numbers in this brand yet. Buy numbers in your SignalWire console, then click{' '}
            <span className="font-medium text-txt-2">Sync from SignalWire</span> to import them.
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: 170 }} />
              <col />
              <col style={{ width: 170 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead className="border-b border-line bg-canvas text-[11px] uppercase tracking-wide text-txt-3">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selected.size > 0 && selected.size === items.length}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && selected.size < items.length;
                    }}
                    onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                    className="h-3.5 w-3.5 cursor-pointer accent-teal"
                  />
                </th>
                <th className="px-3 py-2 font-medium">Number</th>
                <th className="px-3 py-2 font-medium">Label</th>
                <th className="px-3 py-2 font-medium">A2P campaign</th>
                <th className="px-3 py-2 font-medium">Calls (7d)</th>
                <th className="px-3 py-2 font-medium">Connect</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Active</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr key={n.id} className="border-b border-line/50 last:border-b-0">
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select number"
                      checked={selected.has(n.id)}
                      onChange={() => toggleSelected(n.id)}
                      className="h-3.5 w-3.5 cursor-pointer accent-teal"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-mono text-[12.5px] font-medium">{n.e164}</div>
                    {n.signalwireId && (
                      <div className="font-mono text-[10.5px] text-txt-3" title="SignalWire id">
                        {n.signalwireId.slice(0, 12)}…
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <InlineInput
                      initial={n.label ?? ''}
                      placeholder="Add a label…"
                      onCommit={(v) => onLabelCommit(n, v)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <InlineInput
                      initial={n.a2pCampaignId ?? ''}
                      placeholder="Campaign id…"
                      onCommit={(v) => onA2pCommit(n, v)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <span className="font-mono">{n.health.callsLast7d}</span>
                    {n.health.smsLast7d > 0 && (
                      <span className="ml-1.5 text-[10.5px] text-txt-3">
                        · {n.health.smsLast7d} sms
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <ConnectBadge
                      rate={n.health.successRate}
                      sampleSize={n.health.callsLast7d}
                    />
                  </td>
                  <td className="px-3 py-3 text-txt-2">
                    {n.health.lastUsedAt ? timeAgo(n.health.lastUsedAt) : <span className="text-txt-3">never</span>}
                  </td>
                  <td className="px-3 py-3">
                    <Toggle enabled={n.active} onChange={(v) => onActiveToggle(n, v)} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(n.id)}
                      className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-hp/10 hover:text-hp"
                      aria-label="Remove number"
                      title="Remove from brand"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-txt-3">
        Health is computed from the last 7 days of calls + SMS in this brand. Connect rate
        counts dispositions of <code className="rounded bg-canvas px-1">connected</code>,{' '}
        <code className="rounded bg-canvas px-1">sale</code>, and{' '}
        <code className="rounded bg-canvas px-1">callback</code> as wins.
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="text-[10.5px] uppercase tracking-wide text-txt-3">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-txt-3">{sub}</div>}
    </div>
  );
}

function ConnectBadge({ rate, sampleSize }: { rate: number; sampleSize: number }) {
  if (sampleSize === 0) return <span className="text-txt-3">—</span>;
  const pct = Math.round(rate * 100);
  const tone =
    pct >= 30
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : pct >= 15
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-hp/15 text-hp';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>{pct}%</span>
  );
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        enabled ? 'bg-teal' : 'bg-line'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function InlineInput({
  initial,
  placeholder,
  onCommit,
}: {
  initial: string;
  placeholder?: string;
  onCommit: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setValue(initial);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12.5px] outline-none hover:border-line focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
    />
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" strokeLinecap="round" />
    </svg>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}
