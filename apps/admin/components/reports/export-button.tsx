'use client';

// Export button — pulls the per-agent CSV via a server action and
// triggers a browser download.

import { useState, useTransition } from 'react';
import { exportAgentReportCsv, type ReportTabKind } from '@/app/actions/reports';
import type { ReportRange, DirectionFilter } from '@/lib/reports';

export function ExportButton({
  tab,
  range,
  agentId,
  direction,
  fromDate,
  toDate,
}: {
  tab?: ReportTabKind;
  range: ReportRange;
  agentId: string | null;
  direction: DirectionFilter;
  fromDate: string | null;
  toDate: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function trigger() {
    setError(null);
    startTransition(async () => {
      const fromIso = fromDate
        ? new Date(`${fromDate}T00:00:00.000Z`).toISOString()
        : null;
      const toIso = toDate
        ? new Date(`${toDate}T23:59:59.999Z`).toISOString()
        : null;
      const res = await exportAgentReportCsv({
        tab,
        range,
        agentId,
        direction,
        fromIso,
        toIso,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={trigger}
        disabled={pending}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas disabled:opacity-50"
      >
        {pending ? 'Preparing…' : 'Export CSV'}
      </button>
      {error && <span className="text-[10.5px] text-hp">{error}</span>}
    </div>
  );
}
