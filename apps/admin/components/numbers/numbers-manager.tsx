'use client';

// Numbers & Routing manager. Lists every phone number bound to the active
// brand with a small health summary (call/SMS volume + success rate over the
// last 7d), an editable label, an A2P campaign id field, and an active
// toggle. Admins can also pull fresh numbers from SignalWire on demand.

import { useState, useTransition } from 'react';
import {
  bulkDeleteNumbers,
  deleteNumber,
  refreshCnam,
  setA2pCampaignId,
  setNumberActive,
  updateNumberLabel,
} from '@/app/actions/numbers';
import type { NumberWithHealth } from '@/lib/numbers';

type Props = {
  initial: NumberWithHealth[];
};

export function NumbersManager({ initial }: Props) {
  const [items, setItems] = useState<NumberWithHealth[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  function patch(id: string, fn: (n: NumberWithHealth) => NumberWithHealth) {
    setItems((prev) => prev.map((n) => (n.id === id ? fn(n) : n)));
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
  const totalBlocks = items.reduce((s, n) => s + n.health.blockedCalls, 0);
  const blockRate = totalCalls > 0 ? totalBlocks / totalCalls : 0;
  const atRisk = items.filter((n) => n.health.risk !== 'low').length;

  const [refreshing, setRefreshing] = useState<Set<string>>(new Set());

  async function onRefreshCnam(n: NumberWithHealth) {
    setError(null);
    setRefreshing((prev) => new Set(prev).add(n.id));
    const res = await refreshCnam({ id: n.id });
    setRefreshing((prev) => {
      const next = new Set(prev);
      next.delete(n.id);
      return next;
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    patch(n.id, (x) => ({ ...x, cnam: res.cnam, cnamCheckedAt: new Date().toISOString() }));
  }

  return (
    <div className="space-y-4 p-6">
      {/* Health summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Numbers" value={items.length.toString()} />
        <Stat label="Active" value={items.filter((n) => n.active).length.toString()} />
        <Stat label="Calls (7d)" value={totalCalls.toString()} sub={`${totalSms} SMS`} />
        <Stat
          label="Block rate"
          value={totalCalls > 0 ? `${Math.round(blockRate * 100)}%` : '—'}
          sub={totalCalls > 0 ? `${totalBlocks} of ${totalCalls}` : 'no recent calls'}
        />
        <Stat
          label="At risk"
          value={atRisk.toString()}
          sub={atRisk === 0 ? 'all clear' : 'check reputation links'}
        />
      </div>

      <div className="text-[12.5px] text-txt-3">
        Numbers attached to this brand. Edit labels, A2P campaign id, and active state inline.
      </div>

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
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
            No numbers attached to this brand.
          </div>
        ) : (
          <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 140 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 80 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
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
                <th className="px-3 py-2 font-medium">CNAM</th>
                <th className="px-3 py-2 font-medium">A2P campaign</th>
                <th className="px-3 py-2 font-medium">STIR</th>
                <th className="px-3 py-2 font-medium">Block rate</th>
                <th className="px-3 py-2 font-medium">Risk</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Reputation check</th>
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
                    <CnamCell
                      cnam={n.cnam}
                      checkedAt={n.cnamCheckedAt}
                      busy={refreshing.has(n.id)}
                      onRefresh={() => onRefreshCnam(n)}
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
                    <AttestationBadge mix={n.health.attestation} dominant={n.health.dominantAttestation} />
                  </td>
                  <td className="px-3 py-3">
                    <BlockRateBadge
                      rate={n.health.blockRate}
                      blocked={n.health.blockedCalls}
                      sampleSize={n.health.callsLast7d}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <RiskBadge level={n.health.risk} reasons={n.health.riskReasons} />
                  </td>
                  <td className="px-3 py-3 text-txt-2">
                    {n.health.lastUsedAt ? timeAgo(n.health.lastUsedAt) : <span className="text-txt-3">never</span>}
                  </td>
                  <td className="px-3 py-3">
                    <ReputationLinks e164={n.e164} />
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

      <div className="space-y-1.5 text-[11px] text-txt-3">
        <p>
          Health draws from SignalWire's per-call signals captured on the call-status
          webhook — SIP response codes, hangup causes, and STIR/SHAKEN attestation level —
          over the last 7 days.
        </p>
        <p>
          <strong className="text-txt-2">Block rate</strong> = share of calls that ended with
          a carrier-block SIP code (603 “Decline”, 607 “Unwanted”, or 487 “Cancel” with
          &lt;3s duration). <strong className="text-txt-2">STIR</strong> shows the dominant
          attestation level signed on outbound — A is full attestation, B/C trigger
          “Suspected Spam” labels on T-Mobile / AT&amp;T / Verizon. Risk goes high when block
          rate ≥ 12%, less than half of calls sign at A, or daily volume crosses 50/day.
        </p>
        <p>
          <strong className="text-txt-2">CNAM</strong> is fetched on demand from SignalWire
          (~$0.005/lookup) — click <span className="font-medium text-txt-2">Look up</span> to
          fetch the registered caller-ID name terminating carriers see. The reputation links
          remain the ground-truth check on YouMail, NoMoRobo, FreeCallerID, and Hiya.
        </p>
      </div>
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

function RiskBadge({
  level,
  reasons,
}: {
  level: 'low' | 'medium' | 'high';
  reasons: string[];
}) {
  const tone =
    level === 'low'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : level === 'medium'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-hp/15 text-hp';
  const tooltip =
    reasons.length > 0
      ? reasons.join(' · ')
      : 'No carrier-flag heuristics tripped — keep an eye on connect rate.';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}
      title={tooltip}
    >
      {level}
    </span>
  );
}

function ReputationLinks({ e164 }: { e164: string }) {
  // Strip the leading + so a few of the older tools that don't accept it
  // still load directly. URL-encoding the +-prefixed form is fine for the
  // others; we pass both shapes so each link goes to the right page.
  const encoded = encodeURIComponent(e164);
  const naked = e164.replace(/^\+/, '');
  const links = [
    {
      label: 'YouMail',
      href: `https://directory.youmail.com/phone/${naked}`,
      title: 'Crowdsourced spam reports + carrier flag indicators',
    },
    {
      label: 'NoMoRobo',
      href: `https://www.nomorobo.com/lookup/${naked}`,
      title: 'Robocall-blocking database',
    },
    {
      label: 'FreeCallerID',
      href: `https://freecallerid.com/${naked}`,
      title: 'Free reverse lookup + caller ID name',
    },
    {
      label: 'Hiya',
      href: `https://www.hiya.com/${encoded}`,
      title: 'Hiya consumer reputation page',
    },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          title={l.title}
          className="rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[10.5px] text-txt-2 hover:border-teal/40 hover:text-teal"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

function CnamCell({
  cnam,
  checkedAt,
  busy,
  onRefresh,
}: {
  cnam: string | null;
  checkedAt: string | null;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        {cnam ? (
          <>
            <div className="truncate text-[12px]" title={cnam}>
              {cnam}
            </div>
            {checkedAt && (
              <div className="text-[10px] text-txt-3">
                checked {timeAgo(checkedAt)} ago
              </div>
            )}
          </>
        ) : (
          <span className="text-[11.5px] text-txt-3">
            {checkedAt ? 'no name on file' : 'not checked'}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        title="Look up the registered caller-ID name (paid SignalWire query)"
        className="rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[10.5px] text-txt-2 hover:bg-surface-2 disabled:opacity-50"
      >
        {busy ? '…' : cnam ? 'Refresh' : 'Look up'}
      </button>
    </div>
  );
}

function AttestationBadge({
  mix,
  dominant,
}: {
  mix: { A: number; B: number; C: number; unknown: number };
  dominant: 'A' | 'B' | 'C' | 'unknown';
}) {
  if (dominant === 'unknown') {
    return (
      <span className="text-[11px] text-txt-3" title="No STIR/SHAKEN data on recent calls yet.">
        —
      </span>
    );
  }
  const tone =
    dominant === 'A'
      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
      : dominant === 'B'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-hp/15 text-hp';
  const total = mix.A + mix.B + mix.C;
  const tooltip = `A:${mix.A} · B:${mix.B} · C:${mix.C}${mix.unknown ? ` · ?:${mix.unknown}` : ''} (last 7d)`;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
      title={tooltip}
    >
      {dominant} {total > 0 ? `· ${total}` : ''}
    </span>
  );
}

function BlockRateBadge({
  rate,
  blocked,
  sampleSize,
}: {
  rate: number;
  blocked: number;
  sampleSize: number;
}) {
  if (sampleSize === 0) return <span className="text-txt-3">—</span>;
  const pct = Math.round(rate * 100);
  const tone =
    rate >= 0.12
      ? 'bg-hp/15 text-hp'
      : rate >= 0.05
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
      title={`${blocked} of ${sampleSize} calls hit a carrier-block SIP code (603 / 487 short / 607).`}
    >
      {pct}%
    </span>
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
