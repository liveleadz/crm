import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import type {
  Automation,
  AutomationAction,
  AutomationMode,
  WorkflowGraph,
} from './automation-types';

// Re-export so existing server callers (page.tsx, automation-engine) can
// keep importing types + the loader from one module. Client components
// import directly from './automation-types' to avoid the server-only barrier.
export type {
  Automation,
  AutomationAction,
  AutomationMode,
  WorkflowGraph,
} from './automation-types';
export { describeAction, describeBranch, graphFromSimple, linearizeGraph } from './automation-types';

// Trigger types known to the engine. Add new entries here when wiring more
// integration points (e.g. task_completed). The DB column is free-form text
// so unknown values silently no-op rather than blocking saves.
export type AutomationTriggerType =
  | 'disposition_set'
  | 'webhook_received'
  | 'call_received'
  | 'lead_created'
  | 'stage_changed'
  | 'email_received'
  | 'appointment_booked';

export type DispositionTriggerConfig = {
  // Disposition codes that should fire this automation. Matched against
  // calls.disposition (per-brand free-form text).
  codes: string[];
};

const COLUMNS =
  'id, name, description, trigger_type, trigger_config, actions, is_enabled, is_system, sort_order, mode, graph, webhook_token';

function rowToAutomation(a: {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: unknown;
  actions: unknown;
  is_enabled: boolean;
  is_system: boolean;
  sort_order: number;
  mode: string;
  graph: unknown;
  webhook_token?: string | null;
}): Automation {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    triggerType: a.trigger_type,
    triggerConfig: (a.trigger_config as Record<string, unknown>) ?? {},
    actions: Array.isArray(a.actions) ? (a.actions as unknown as AutomationAction[]) : [],
    isEnabled: a.is_enabled,
    isSystem: a.is_system,
    sortOrder: a.sort_order,
    mode: (a.mode === 'graph' ? 'graph' : 'simple') as AutomationMode,
    graph: a.graph ? (a.graph as unknown as WorkflowGraph) : null,
    webhookToken: a.webhook_token ?? null,
  };
}

export async function loadAutomations(brandId: string): Promise<Automation[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('automations')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .order('sort_order', { ascending: true });
  if (!data) return [];
  return data.map(rowToAutomation);
}

export async function loadAutomation(id: string): Promise<Automation | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('automations')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  return rowToAutomation(data);
}
