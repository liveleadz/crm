'use server';

// CSV export for the per-agent report. Returns the raw CSV body so the
// client can trigger a Blob download — keeps us off the file system and
// out of any runtime/streaming complexity for a small payload.

import { getActiveBrand } from '@/lib/active-brand';
import {
  loadCallReport,
  type ReportRange,
  type DirectionFilter,
  formatDuration,
  formatPct,
} from '@/lib/reports';

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportAgentReportCsv(input: {
  range: ReportRange;
  agentId?: string | null;
  direction?: DirectionFilter;
}): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  try {
    const active = await getActiveBrand();
    if (!active) return { ok: false, error: 'No active brand.' };
    const report = await loadCallReport(active.id, {
      range: input.range,
      agentId: input.agentId ?? null,
      direction: input.direction ?? 'all',
    });

    const header = [
      'Agent',
      'Email',
      'Calls',
      'Connects',
      'Connect %',
      'Avg talk',
      'Total talk (sec)',
      'Sales',
      'Close %',
    ];
    const lines = [header.map(csvEscape).join(',')];
    for (const r of report.byAgent) {
      lines.push(
        [
          r.name,
          r.email,
          r.calls,
          r.connects,
          formatPct(r.connectRate),
          formatDuration(r.avgTalkSec),
          r.totalTalkSec,
          r.sales,
          formatPct(r.salesRate),
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    const csv = lines.join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `agent-report_${active.id}_${input.range}_${stamp}.csv`;
    return { ok: true, csv, filename };
  } catch (err) {
    console.error('[exportAgentReportCsv]', err);
    const message = err instanceof Error ? err.message : 'Export failed.';
    return { ok: false, error: message };
  }
}
