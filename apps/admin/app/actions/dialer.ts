'use server';

import { revalidatePath } from 'next/cache';
import { getActiveBrand } from '@/lib/active-brand';
import { getMyProfile, getOutboundFromNumber, getPublicAppUrl, toE164 } from '@/lib/dialer';
import { createServerClient } from '@leadpilot/db/server';

type StartCallResult =
  | { ok: true; callId: string; signalwireCallId: string }
  | { ok: false; code?: string; error: string };

/**
 * Initiate an outbound call as a PSTN bridge:
 *   1. SignalWire calls the agent's mobile (caller-ID = our brand number).
 *   2. When the agent answers, SignalWire fetches /api/laml/dial.
 *   3. That endpoint returns <Dial callerId={brand}><Number>{lead}</Number></Dial>.
 *   4. SignalWire bridges the two legs; the lead sees our brand number.
 */
export async function startCall(input: {
  toNumber: string;
  leadId?: string | null;
}): Promise<StartCallResult> {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  const token = process.env.SIGNALWIRE_TOKEN;
  const spaceUrl = process.env.SIGNALWIRE_SPACE_URL;
  const webhookSecret = process.env.LAML_WEBHOOK_SECRET;
  if (!projectId || !token || !spaceUrl || !webhookSecret) {
    return {
      ok: false,
      code: 'credentials_missing',
      error:
        'Telephony env not configured. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_SPACE_URL, and LAML_WEBHOOK_SECRET.',
    };
  }

  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand selected.' };

  const to = toE164(input.toNumber);
  if (!to) return { ok: false, error: 'Enter a valid phone number.' };

  const fromNumber = await getOutboundFromNumber(active.id);
  if (!fromNumber) {
    return {
      ok: false,
      code: 'no_brand_number',
      error: `No outbound number assigned to ${active.name}.`,
    };
  }

  const profile = await getMyProfile();
  if (!profile) return { ok: false, error: 'Not authenticated.' };
  if (!profile.mobilePhone) {
    return {
      ok: false,
      code: 'mobile_missing',
      error: 'Add your mobile phone number first so we can ring you when the call connects.',
    };
  }
  const agentMobile = toE164(profile.mobilePhone);
  if (!agentMobile) {
    return { ok: false, code: 'mobile_invalid', error: 'Your mobile phone number is invalid.' };
  }

  const appUrl = getPublicAppUrl();
  const lamlUrl = new URL(`${appUrl}/api/laml/dial`);
  lamlUrl.searchParams.set('to', to);
  lamlUrl.searchParams.set('from', fromNumber.e164);
  lamlUrl.searchParams.set('secret', webhookSecret);

  const statusUrl = new URL(`${appUrl}/api/laml/status`);
  statusUrl.searchParams.set('secret', webhookSecret);

  const cleanSpace = spaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const callsEndpoint = `https://${cleanSpace}/api/laml/2010-04-01/Accounts/${projectId}/Calls.json`;

  const body = new URLSearchParams();
  body.set('From', fromNumber.e164);
  body.set('To', agentMobile);
  body.set('Url', lamlUrl.toString());
  body.set('StatusCallback', statusUrl.toString());
  body.set('StatusCallbackMethod', 'POST');
  for (const ev of ['initiated', 'ringing', 'answered', 'completed']) {
    body.append('StatusCallbackEvent', ev);
  }

  let signalwireCallId: string;
  try {
    const res = await fetch(callsEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${projectId}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        code: 'signalwire_error',
        error: `SignalWire ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as { sid?: string };
    if (!json.sid) {
      return { ok: false, code: 'signalwire_no_sid', error: 'SignalWire did not return a call SID.' };
    }
    signalwireCallId = json.sid;
  } catch (e) {
    return {
      ok: false,
      code: 'signalwire_fetch_failed',
      error: `SignalWire request failed: ${(e as Error).message}`,
    };
  }

  // Persist the call row. RLS allows insert because the active brand is
  // one the current user belongs to.
  const supabase = await createServerClient();
  const { data: inserted, error: insertErr } = await supabase
    .from('calls')
    .insert({
      brand_id: active.id,
      lead_id: input.leadId ?? null,
      member_id: profile.id,
      number_id: fromNumber.id,
      direction: 'outbound',
      from_number: fromNumber.e164,
      to_number: to,
      signalwire_call_id: signalwireCallId,
    })
    .select('id')
    .single();
  if (insertErr || !inserted) {
    return {
      ok: false,
      code: 'db_insert_failed',
      error: insertErr?.message ?? 'Could not log call.',
    };
  }

  revalidatePath('/calls');
  return { ok: true, callId: inserted.id, signalwireCallId };
}

export async function setMyMobile(input: { mobile: string }): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const e164 = toE164(input.mobile);
  if (!e164) return { ok: false, error: 'Enter a valid phone number.' };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };
  const { error } = await supabase
    .from('members')
    .update({ mobile_phone: e164 })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dialer');
  return { ok: true };
}
