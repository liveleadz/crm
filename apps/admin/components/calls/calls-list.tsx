'use client';

import { useMemo, useState } from 'react';
import type { CallRow } from '@/lib/calls';
import type { LeadStage } from '@/lib/leads';
import { LeadDetailDrawer } from '@/components/leads/lead-detail-drawer';

const DISPOSITION_LABEL: Record<string, string> = {
  connected: 'Connected',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  wrong_number: 'Wrong number',
  do_not_call: 'DNC',
  callback: 'Callback',
  sale: 'Sale',
  not_interested: 'Not interested',
};

type DirectionFilter = 'all' | 'outbound' | 'inbound';
type DispositionFilter = 'all' | keyof typeof DISPOSITION_LABEL;
type RangeFilter = 'all' | '24h' | '7d' | '30d';

function formatDuration(sec: number | null) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function leadName(c: CallRow) {
  const n = [c.leadFirstName, c.leadLastName].filter(Boolean).join(' ').trim();
  return n || '—';
}

function rangeMs(r: RangeFilter): number | null {
  if (r === '24h') return 24 * 60 * 60 * 1000;
  if (r === '7d') return 7 * 24 * 60 * 60 * 1000;
  if (r === '30d') return 30 * 24 * 60 * 60 * 1000;
  return null;
}

export function CallsList({ stages, calls }: { stages: LeadStage[]; calls: CallRow[] }) {
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [disposition, setDisposition] = useState<DispositionFilter>('all');
  const [range, setRange] = useState<RangeFilter>('all');
  const [search, setSearch] = useState('');
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const cutoff = (() => {
      const ms = rangeMs(range);
      return ms === null ? null : Date.now() - ms;
    })();
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      if (direction !== 'all' && c.direction !== direction) return false;
      if (disposition !== 'all' && c.disposition !== disposition) return false;
      if (cutoff !== null && new Date(c.startedAt).getTime() < cutoff) return false;
      if (q) {
        const name = leadName(c).toLowerCase();
        const phone = (c.leadPhone ?? '').toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
  }, [calls, direction, disposition, range, search]);

  return (
    <>
      <div className="border-b border-line bg-surface px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-canvas p-0.5">
            {(['all', 'outbound', 'inbound'] as DirectionFilter[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium capitalize ${
                  direction === d ? 'bg-surface text-txt-1 shadow-sm' : 'text-txt-3 hover:text-txt-2'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as DispositionFilter)}
            className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          >
            <option value="all">All dispositions</option>
            {Object.entries(DISPOSITION_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <div className="flex rounded-lg border border-line bg-canvas p-0.5">
            {(['all', '24h', '7d', '30d'] as RangeFilter[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ${
                  range === r ? 'bg-surface text-txt-1 shadow-sm' : 'text-txt-3 hover:text-txt-2'
                }`}
              >
                {r === 'all' ? 'All' : r}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lead name or phone…"
            className="ml-auto w-64 rounded-lg border border-line bg-canvas px-2.5 py-1 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <span className="font-mono text-[11px] text-txt-3">
            {filtered.length} / {calls.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center p-12">
            <p className="text-[12.5px] text-txt-3">No calls match these filters.</p>
          </div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 border-b border-line bg-canvas text-left">
              <tr className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                <th className="px-6 py-2.5">Lead</th>
                <th className="px-3 py-2.5">Direction</th>
                <th className="px-3 py-2.5">Disposition</th>
                <th className="px-3 py-2.5">Duration</th>
                <th className="px-3 py-2.5">Number</th>
                <th className="px-6 py-2.5 text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const counterparty = c.direction === 'outbound' ? c.toNumber : c.fromNumber;
                return (
                  <tr
                    key={c.id}
                    onClick={() => c.leadId && setOpenLeadId(c.leadId)}
                    className={`border-b border-line/60 transition-colors ${
                      c.leadId ? 'cursor-pointer hover:bg-surface' : 'opacity-60'
                    }`}
                  >
                    <td className="px-6 py-2.5">
                      <span className="font-medium">{leadName(c)}</span>
                      {c.leadPhone && (
                        <span className="ml-2 font-mono text-[11px] text-txt-3">
                          {c.leadPhone}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium capitalize ${
                          c.direction === 'outbound'
                            ? 'bg-teal/15 text-teal'
                            : 'bg-bs/15 text-bs'
                        }`}
                      >
                        {c.direction}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-txt-2">
                      {c.disposition ? DISPOSITION_LABEL[c.disposition] ?? c.disposition : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-txt-2">
                      {formatDuration(c.durationSec)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11.5px] text-txt-3">
                      {counterparty}
                    </td>
                    <td className="px-6 py-2.5 text-right font-mono text-[11.5px] text-txt-3">
                      {formatWhen(c.startedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <LeadDetailDrawer
        leadId={openLeadId}
        stages={stages}
        onClose={() => setOpenLeadId(null)}
      />
    </>
  );
}
