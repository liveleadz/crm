import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import type { Automation, AutomationAction } from './automation-types';

// Re-export so existing server callers (page.tsx, automation-engine) can
// keep importing types + the loader from one module. Client components
// import directly from './automation-types' to avoid the server-only barrier.
export type { Automation, AutomationAction } from './automation-types';
export { describeAction } from './automation-types';

// Trigger types known to the engine. Add new entries here when wiring more
// integration points (e.g. lead_created, task_completed). The DB column is
// free-form text so unknown values silently no-op rather than blocking saves.
export type AutomationTriggerType = 'disposition_set';

export type DispositionTriggerConfig = {
  // Disposition codes that should fire this automation. Matched against
  // calls.disposition (per-brand free-form text).
  codes: string[];
};

export async function loadAutomations(brandId: string): Promise<Automation[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('automations')
    .select('id, name, description, trigger_type, trigger_config, actions, is_enabled, is_system, sort_order')
    .eq('brand_id', brandId)
    .order('sort_order', { ascending: true });
  if (!data) return [];
  return data.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    triggerType: a.trigger_type,
    triggerConfig: (a.trigger_config as Record<string, unknown>) ?? {},
    actions: Array.isArray(a.actions) ? (a.actions as unknown as AutomationAction[]) : [],
    isEnabled: a.is_enabled,
    isSystem: a.is_system,
    sortOrder: a.sort_order,
  }));
}
