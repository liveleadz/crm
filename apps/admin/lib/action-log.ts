// Server-only loader for the Activity tab on the automation editor. Returns
// the most-recent action_log rows for an automation, decorated with the
// lead's display name when scoped to one.

import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type ActionLogStatus = 'ok' | 'skipped' | 'failed';

export type ActionLogRow = {
  id: string;
  triggerType: string;
  actionKind: string;
  status: ActionLogStatus;
  detail: Record<string, unknown> | null;
  createdAt: string;
  workflowRunId: string | null;
  lead: { id: string; name: string } | null;
};

export async function loadRecentActionLog(
  automationId: string,
  limit = 100,
): Promise<ActionLogRow[]> {
  const supabase = await createServerClient();
  const { data: rows } = await supabase
    .from('action_log')
    .select('id, trigger_type, action_kind, status, detail, created_at, workflow_run_id, lead_id')
    .eq('automation_id', automationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!rows || rows.length === 0) return [];

  const leadIds = Array.from(
    new Set(rows.map((r) => r.lead_id).filter((id): id is string => !!id)),
  );
  const leadById = new Map<
    string,
    { id: string; first_name: string | null; last_name: string | null; phone: string | null }
  >();
  if (leadIds.length > 0) {
    const { data } = await supabase
      .from('leads')
      .select('id, first_name, last_name, phone')
      .in('id', leadIds);
    for (const l of data ?? []) leadById.set(l.id, l);
  }

  return rows.map((r): ActionLogRow => {
    const lead = r.lead_id ? leadById.get(r.lead_id) ?? null : null;
    return {
      id: r.id,
      triggerType: r.trigger_type,
      actionKind: r.action_kind,
      status: r.status as ActionLogStatus,
      detail: (r.detail as Record<string, unknown> | null) ?? null,
      createdAt: r.created_at,
      workflowRunId: r.workflow_run_id,
      lead: lead
        ? {
            id: lead.id,
            name:
              [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() ||
              lead.phone ||
              'Unnamed lead',
          }
        : null,
    };
  });
}
