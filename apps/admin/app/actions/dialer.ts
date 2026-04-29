'use server';

import { getActiveBrand } from '@/lib/active-brand';
import { createServerClient } from '@leadpilot/db/server';

/**
 * startCall initiates an outbound call via SignalWire.
 *
 * Until SIGNALWIRE_PROJECT_ID / SIGNALWIRE_TOKEN / SIGNALWIRE_SPACE_URL
 * are configured, this action validates the request and returns a
 * `credentials_missing` error so the UI can surface it. When creds land
 * the body will issue the LaML POST and persist the call row.
 */
export async function startCall(input: { toNumber: string; leadId?: string | null }) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const to = input.toNumber.trim();
  if (!to) return { ok: false as const, error: 'Phone number is required' };

  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const token = process.env.SIGNALWIRE_TOKEN;
  const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
  if (!projectId || !token || !spaceUrl) {
    return {
      ok: false as const,
      code: 'credentials_missing' as const,
      error:
        'SignalWire credentials not configured. Add SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, and SIGNALWIRE_SPACE_URL to admin/.env.local.',
    };
  }

  // Real integration goes here. Will:
  //   1. Pick a from_number for the active brand from the `numbers` table.
  //   2. POST to https://{spaceUrl}/api/laml/2010-04-01/Accounts/{projectId}/Calls
  //      with To/From/Url (LaML bin or webhook returning <Dial>).
  //   3. Insert into `calls` with signalwire_call_id, started_at, direction='outbound'.
  //   4. Return { ok: true, callId }.
  return {
    ok: false as const,
    code: 'not_implemented' as const,
    error: 'SignalWire integration is wired up to env but not yet implemented.',
  };
}
