'use server';

// CSV export for the reports page. Returns the raw CSV body so the
// client can trigger a Blob download — keeps us off the file system and
// out of any runtime/streaming complexity for a small payload. Dispatches
// on the active tab so each report kind emits its own CSV shape.

import { getActiveBrand } from '@/lib/active-brand';
import { getCurrentBrandRole } from '@/lib/team';
import { getMyProfile } from '@/lib/dialer';
import {
  loadCallReport,
  loadEmailReport,
  loadPipelineReport,
  loadAppointmentsReport,
  loadSmsReport,
  loadCampaignReport,
  type ReportFilter,
  type ReportRange,
  type DirectionFilter,
  formatDuration,
  formatPct,
} from '@/lib/reports';

export type ReportTabKind =
  | 'calls'
  | 'email'
  | 'pipeline'
  | 'appointments'
  | 'sms'
  | 'campaigns';

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function joinCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}

export async function exportAgentReportCsv(input: {
  tab?: ReportTabKind;
  range: ReportRange;
  agentId?: string | null;
  direction?: DirectionFilter;
  fromIso?: string | null;
  toIso?: string | null;
}): Promise<{ ok: true; csv: string; filename: string } | { ok: false; error: string }> {
  try {
    const active = await getActiveBrand();
    if (!active) return { ok: false, error: 'No active brand.' };

    // Mirror the report page's self-scope: agents/viewers can't export
    // a colleague's slice via the input.agentId. The loader's
    // effectiveFilter() rewrites agentId to viewerMemberId, but we
    // also pass it explicitly so the filter object is consistent.
    const role = await getCurrentBrandRole(active.id);
    const profile = await getMyProfile();
    const viewerMemberId =
      profile && (role === 'agent' || role === 'viewer') ? profile.id : null;

    const filter: ReportFilter = {
      range: input.range,
      agentId: viewerMemberId ?? input.agentId ?? null,
      direction: input.direction ?? 'all',
      fromIso: input.fromIso ?? null,
      toIso: input.toIso ?? null,
      timezone: active.timezone,
      viewerMemberId,
    };

    const tab: ReportTabKind = input.tab ?? 'calls';
    const stamp = new Date().toISOString().slice(0, 10);
    let csv: string;
    let filename: string;

    if (tab === 'email') {
      const report = await loadEmailReport(active.id, filter);
      const rows: (string | number)[][] = [
        ['Agent', 'Email', 'Sent', 'Received', 'Replied', 'Reply %', 'Avg response (min)'],
      ];
      for (const r of report.perAgent) {
        rows.push([
          r.name,
          r.email,
          r.sent,
          r.received,
          r.replied,
          formatPct(r.replyRate),
          r.avgResponseMin,
        ]);
      }
      csv = joinCsv(rows);
      filename = `email-report_${active.id}_${input.range}_${stamp}.csv`;
    } else if (tab === 'pipeline') {
      const report = await loadPipelineReport(active.id, filter);
      const rows: (string | number)[][] = [
        ['Stage', 'Position', 'Won', 'Lost', 'Count', '% of top', 'Conversion to next'],
      ];
      for (const s of report.stages) {
        rows.push([
          s.name,
          s.position,
          s.isWon ? 'yes' : '',
          s.isLost ? 'yes' : '',
          s.count,
          formatPct(s.pctOfTop),
          s.conversion === null ? '' : formatPct(s.conversion),
        ]);
      }
      csv = joinCsv(rows);
      filename = `pipeline-report_${active.id}_${input.range}_${stamp}.csv`;
    } else if (tab === 'appointments') {
      const report = await loadAppointmentsReport(active.id, filter);
      const rows: (string | number)[][] = [
        ['Closer', 'Email', 'Booked', 'Showed', 'No-show', 'Cancelled', 'Show %'],
      ];
      for (const r of report.perCloser) {
        rows.push([
          r.name,
          r.email,
          r.booked,
          r.showed,
          r.noShowed,
          r.cancelled,
          formatPct(r.showRate),
        ]);
      }
      csv = joinCsv(rows);
      filename = `appointments-report_${active.id}_${input.range}_${stamp}.csv`;
    } else if (tab === 'sms') {
      const report = await loadSmsReport(active.id, filter);
      const rows: (string | number)[][] = [['Date', 'Sent', 'Delivered']];
      for (const p of report.trend) {
        rows.push([p.date, p.sent, p.delivered]);
      }
      // Append totals row for quick reference.
      rows.push(['Total', report.kpis.sent, report.kpis.delivered]);
      csv = joinCsv(rows);
      filename = `sms-report_${active.id}_${input.range}_${stamp}.csv`;
    } else if (tab === 'campaigns') {
      const report = await loadCampaignReport(active.id, filter);
      const rows: (string | number)[][] = [
        ['Campaign', 'Status', 'Calls', 'Connects', 'Connect %', 'Appointments', 'Show %'],
      ];
      for (const r of report.rows) {
        rows.push([
          r.name,
          r.status,
          r.calls,
          r.connects,
          formatPct(r.connectRate),
          r.appointmentsBooked,
          formatPct(r.showRate),
        ]);
      }
      rows.push([
        'Total',
        '',
        report.totals.calls,
        report.totals.connects,
        formatPct(report.totals.connectRate),
        report.totals.appointmentsBooked,
        formatPct(report.totals.showRate),
      ]);
      csv = joinCsv(rows);
      filename = `campaign-report_${active.id}_${input.range}_${stamp}.csv`;
    } else {
      const report = await loadCallReport(active.id, filter);
      const rows: (string | number)[][] = [
        [
          'Agent',
          'Email',
          'Calls',
          'Connects',
          'Connect %',
          'Avg talk',
          'Total talk (sec)',
          'Sales',
          'Close %',
        ],
      ];
      for (const r of report.byAgent) {
        rows.push([
          r.name,
          r.email,
          r.calls,
          r.connects,
          formatPct(r.connectRate),
          formatDuration(r.avgTalkSec),
          r.totalTalkSec,
          r.sales,
          formatPct(r.salesRate),
        ]);
      }
      csv = joinCsv(rows);
      filename = `agent-report_${active.id}_${input.range}_${stamp}.csv`;
    }

    return { ok: true, csv, filename };
  } catch (err) {
    console.error('[exportAgentReportCsv]', err);
    const message = err instanceof Error ? err.message : 'Export failed.';
    return { ok: false, error: message };
  }
}
