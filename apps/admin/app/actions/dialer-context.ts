'use server';

// Server action wrapper around loadLeadCallContext. Keeps the brand-scope
// guard out of the client so the dialer just calls a single thunk per
// active lead.

import { getActiveBrand } from '@/lib/active-brand';
import { loadLeadCallContext, type LeadCallContext } from '@/lib/lead-context';

export async function loadDialerContext(
  leadId: string,
): Promise<{ ok: true; context: LeadCallContext | null } | { ok: false; error: string }> {
  try {
    const active = await getActiveBrand();
    if (!active) return { ok: false, error: 'No active brand.' };
    const context = await loadLeadCallContext(active.id, leadId);
    return { ok: true, context };
  } catch (err) {
    console.error('[loadDialerContext]', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to load context.' };
  }
}
