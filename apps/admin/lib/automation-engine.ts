import 'server-only';

// Synchronous, fire-and-forget automation runner. Called immediately after
// the triggering server action persists its primary write (e.g. setDisposition
// finishes updating the calls row). Each enabled automation matching the
// trigger runs its actions in order using the user's RLS-scoped client, so
// any permission failure surfaces as a per-action error logged but not
// thrown — automations should never block the primary write.
//
// V1 keeps things deliberately simple: no queue, no retries, no fan-out.

import { createServerClient } from '@leadpilot/db/server';
import type { AutomationAction } from '@/lib/automations';

type DispositionTrigger = {
  trigger: 'disposition_set';
  brandId: string;
  callId: string;
  leadId: string | null;
  memberId: string | null;
  disposition: string;
  callbackAt: string | null;
};

export type AutomationTriggerInput = DispositionTrigger;

type Row = {
  id: string;
  name: string;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
};

export async function runAutomations(input: AutomationTriggerInput): Promise<void> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('automations')
    .select('id, name, trigger_config, actions')
    .eq('brand_id', input.brandId)
    .eq('trigger_type', input.trigger)
    .eq('is_enabled', true)
    .order('sort_order', { ascending: true });

  if (error || !data) return;

  // Filter rows whose trigger_config matches the firing event.
  const matched = (data as unknown as Row[]).filter((row) => matches(row.trigger_config, input));

  for (const row of matched) {
    for (const action of row.actions) {
      try {
        await runAction(action, input);
      } catch (e) {
        // Best-effort: log and keep going. Future: persist to an
        // automation_runs table so users see why a rule didn't apply.
        console.error('[automations]', row.name, action.kind, (e as Error).message);
      }
    }
  }
}

function matches(config: Record<string, unknown>, input: AutomationTriggerInput): boolean {
  if (input.trigger === 'disposition_set') {
    const codes = config.codes;
    if (!Array.isArray(codes) || codes.length === 0) return false;
    return codes.includes(input.disposition);
  }
  return false;
}

async function runAction(action: AutomationAction, input: AutomationTriggerInput): Promise<void> {
  if (!input.leadId) return; // Every v1 action targets a lead.
  const supabase = await createServerClient();

  switch (action.kind) {
    case 'move_stage': {
      await supabase
        .from('leads')
        .update({ stage_id: action.stage_id })
        .eq('id', input.leadId);
      return;
    }
    case 'mark_dnc': {
      await supabase
        .from('leads')
        .update({ do_not_call: true })
        .eq('id', input.leadId);
      return;
    }
    case 'add_tag': {
      // Idempotent: ignore if the lead already has the tag.
      await supabase
        .from('lead_tags')
        .upsert(
          { lead_id: input.leadId, tag_id: action.tag_id },
          { onConflict: 'lead_id,tag_id', ignoreDuplicates: true },
        );
      return;
    }
    case 'create_task': {
      const dueAt = resolveDueAt(action, input);
      await supabase.from('tasks').insert({
        brand_id: input.brandId,
        lead_id: input.leadId,
        assignee_id: action.assign_to_caller ? input.memberId : null,
        title: action.title,
        kind: action.task_kind ?? 'other',
        due_at: dueAt,
      });
      return;
    }
  }
}

function resolveDueAt(
  action: Extract<AutomationAction, { kind: 'create_task' }>,
  input: AutomationTriggerInput,
): string | null {
  if (action.use_callback_at && input.trigger === 'disposition_set' && input.callbackAt) {
    return input.callbackAt;
  }
  if (typeof action.due_in_minutes === 'number') {
    return new Date(Date.now() + action.due_in_minutes * 60_000).toISOString();
  }
  return null;
}
