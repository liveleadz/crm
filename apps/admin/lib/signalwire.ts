// Server-only thin client for SignalWire's REST + Fabric APIs. Today we only
// need it to list the project's phone numbers so admins can sync the ones
// they bought in the SignalWire console into the brand's `numbers` table.

import 'server-only';

export type SignalWirePhoneNumber = {
  id: string;
  number: string; // E.164
  name: string | null;
  capabilities: string[]; // ['voice','sms','mms','fax']
  number_type: string | null; // 'longcode' | 'tollfree' | 'shortcode' …
  call_handler: string | null;
  message_handler: string | null;
  created_at: string | null;
  // Anything else the API returns that we surface as-is in the UI.
};

function basicAuth(): string | null {
  const id = process.env.SIGNALWIRE_PROJECT_ID;
  const tok = process.env.SIGNALWIRE_TOKEN;
  if (!id || !tok) return null;
  return Buffer.from(`${id}:${tok}`).toString('base64');
}

function spaceUrl(): string | null {
  const raw = process.env.SIGNALWIRE_SPACE_URL;
  if (!raw) return null;
  // Some envs paste with protocol, some without — normalize to no trailing slash.
  return raw.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export type SwResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number };

/**
 * GET helper for the SignalWire REST API. Always returns a tagged result so
 * callers can surface auth/config issues to the UI without throwing.
 */
async function swGet<T>(path: string): Promise<SwResult<T>> {
  const auth = basicAuth();
  const space = spaceUrl();
  if (!auth || !space) {
    return {
      ok: false,
      error:
        'SignalWire credentials missing. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_SPACE_URL.',
    };
  }
  const url = `https://${space}${path.startsWith('/') ? path : `/${path}`}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
      },
      // SignalWire is fast; cap to keep the UI responsive.
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}` };
  }
  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      status: res.status,
      error: body ? `${res.status} ${body.slice(0, 240)}` : `HTTP ${res.status}`,
    };
  }
  const json = (await res.json()) as T;
  return { ok: true, data: json };
}

/**
 * List every phone number provisioned to the SignalWire project. Pages up to
 * 200 (the API caps at 50/page, so 4 pages = 200 numbers — far more than any
 * brand needs at this stage).
 */
/**
 * CNAM lookup — tells you the registered caller-ID name a destination
 * carrier sees when this number rings. SignalWire bills ~$0.005 per query,
 * so we expose it as an on-demand action (no auto-sync) and cache the
 * result on numbers.cnam / numbers.cnam_checked_at.
 */
export type CnamLookupResult = {
  caller_name?: string | null;
  carrier_name?: string | null;
  line_type?: string | null;
};

export async function lookupCnam(e164: string): Promise<SwResult<CnamLookupResult>> {
  const naked = e164.replace(/^\+/, '');
  const path = `/api/laml/2010-04-01/Accounts/${process.env.SIGNALWIRE_PROJECT_ID}/Lookup.json?PhoneNumber=%2B${naked}&Type=cnam`;
  const res = await swGet<{
    cnam?: { caller_name?: string | null };
    carrier?: { name?: string | null; type?: string | null };
  }>(path);
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      caller_name: res.data.cnam?.caller_name ?? null,
      carrier_name: res.data.carrier?.name ?? null,
      line_type: res.data.carrier?.type ?? null,
    },
  };
}

/**
 * Look up a SignalWire IncomingPhoneNumber SID by its E.164 number. We need
 * the SID to PATCH the number's voice handler (the LaML API addresses
 * numbers by SID, not by phone). Returns null if no match.
 */
export async function findIncomingPhoneNumberSid(
  e164: string,
): Promise<SwResult<string | null>> {
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  if (!projectId) {
    return { ok: false, error: 'SIGNALWIRE_PROJECT_ID not configured' };
  }
  // LaML expects PhoneNumber to include the leading +; encode it.
  const encoded = encodeURIComponent(e164);
  const path = `/api/laml/2010-04-01/Accounts/${projectId}/IncomingPhoneNumbers.json?PhoneNumber=${encoded}`;
  const res = await swGet<{
    incoming_phone_numbers?: Array<{ sid: string; phone_number: string }>;
  }>(path);
  if (!res.ok) return res;
  const match = (res.data.incoming_phone_numbers ?? []).find(
    (n) => n.phone_number === e164,
  );
  return { ok: true, data: match?.sid ?? null };
}

/**
 * Update an IncomingPhoneNumber's voice webhook so inbound calls POST to our
 * SWML route. SignalWire's LaML API uses form-encoded body for updates.
 */
export async function setIncomingPhoneNumberVoiceUrl(input: {
  sid: string;
  voiceUrl: string;
  voiceMethod?: 'POST' | 'GET';
}): Promise<SwResult<{ sid: string; voice_url: string | null }>> {
  const auth = basicAuth();
  const space = spaceUrl();
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  if (!auth || !space || !projectId) {
    return {
      ok: false,
      error:
        'SignalWire credentials missing. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_SPACE_URL.',
    };
  }
  const url = `https://${space}/api/laml/2010-04-01/Accounts/${projectId}/IncomingPhoneNumbers/${input.sid}.json`;
  const form = new URLSearchParams({
    VoiceUrl: input.voiceUrl,
    VoiceMethod: input.voiceMethod ?? 'POST',
  });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      error: body ? `${res.status} ${body.slice(0, 240)}` : `HTTP ${res.status}`,
    };
  }
  const json = (await res.json()) as { sid?: string; voice_url?: string | null };
  return { ok: true, data: { sid: json.sid ?? input.sid, voice_url: json.voice_url ?? null } };
}

/**
 * Send an SMS via SignalWire's LaML Messages API. Returns the provider's
 * message SID on success. Used by the message_outbox drain worker.
 */
export async function sendSignalWireSms(input: {
  from: string;
  to: string;
  body: string;
}): Promise<SwResult<{ sid: string }>> {
  const auth = basicAuth();
  const space = spaceUrl();
  const projectId = process.env.SIGNALWIRE_PROJECT_ID;
  if (!auth || !space || !projectId) {
    return {
      ok: false,
      error:
        'SignalWire credentials missing. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_SPACE_URL.',
    };
  }
  const url = `https://${space}/api/laml/2010-04-01/Accounts/${projectId}/Messages.json`;
  const form = new URLSearchParams({
    From: input.from,
    To: input.to,
    Body: input.body,
  });
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      status: res.status,
      error: body ? `${res.status} ${body.slice(0, 240)}` : `HTTP ${res.status}`,
    };
  }
  const json = (await res.json()) as { sid?: string };
  return { ok: true, data: { sid: json.sid ?? '' } };
}

type SwListPage = {
  data: SignalWirePhoneNumber[];
  links?: { next: string | null };
};

export async function listSignalWirePhoneNumbers(): Promise<
  SwResult<SignalWirePhoneNumber[]>
> {
  const out: SignalWirePhoneNumber[] = [];
  let next: string | null = '/api/relay/rest/phone_numbers?page_size=50';
  let pages = 0;
  while (next && pages < 4) {
    const res: SwResult<SwListPage> = await swGet<SwListPage>(next);
    if (!res.ok) return res;
    out.push(...(res.data.data ?? []));
    next = res.data.links?.next ?? null;
    pages++;
  }
  return { ok: true, data: out };
}
