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
 * Look up the Call Fabric audio address for a Subscriber identified by its
 * email reference. The canonical audio address (returned by the Fabric API
 * as `addresses[].channels.audio`) is the only string that reliably routes
 * a SWML connect.to to a WS-online subscriber — guessing the local-part is
 * NOT reliable (auto-provisioned resource names don't always match what we
 * assume). When dispatch goes to a wrong address, Fabric silently times
 * out the connect (~15-20s) and the browser never sees an invite.
 *
 * Cached in-process so warm lambdas don't repay the 200-500ms lookup on
 * every inbound webhook. Cache key is the lowercased email; TTL is 1h
 * (long enough to amortize, short enough that a deleted/re-provisioned
 * subscriber recovers without a redeploy).
 *
 * Returns null if no subscriber matches or the API call fails.
 */
const audioAddressCache = new Map<string, { addr: string; expiresAt: number }>();
const AUDIO_ADDRESS_TTL_MS = 60 * 60 * 1000;

export async function findSubscriberAudioAddress(email: string): Promise<string | null> {
  const auth = basicAuth();
  const space = spaceUrl();
  if (!auth || !space) return null;
  const target = email.toLowerCase();
  const cached = audioAddressCache.get(target);
  if (cached && cached.expiresAt > Date.now()) return cached.addr;
  let url: string | null = `https://${space}/api/fabric/resources/subscribers?page_size=50`;
  while (url) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
        cache: 'no-store',
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | {
          data?: Array<{ id: string; subscriber?: { email?: string } }>;
          links?: { next?: string | null };
        }
      | null;
    if (!json?.data) return null;
    const match = json.data.find(
      (r) => r.subscriber?.email?.toLowerCase() === target,
    );
    if (match) {
      try {
        const aRes = await fetch(
          `https://${space}/api/fabric/resources/${match.id}/addresses`,
          {
            headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
            cache: 'no-store',
          },
        );
        if (!aRes.ok) return null;
        const aJson = (await aRes.json().catch(() => null)) as
          | { data?: Array<{ name: string; channels?: { audio?: string } }> }
          | null;
        const addr = aJson?.data?.[0];
        let resolved: string | null = null;
        if (addr?.channels?.audio) resolved = addr.channels.audio;
        else if (addr?.name) resolved = `/private/${addr.name}?channel=audio`;
        if (resolved) {
          audioAddressCache.set(target, {
            addr: resolved,
            expiresAt: Date.now() + AUDIO_ADDRESS_TTL_MS,
          });
        }
        return resolved;
      } catch {
        return null;
      }
    }
    url = json.links?.next ?? null;
  }
  return null;
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
 * Find a Fabric resource by display name + type. Used to resolve the
 * project's `leadpilot-inbound` swml_webhook so inbound calls can be
 * bound to it via the Resource API.
 *
 * Why we don't take the resource ID via env: the resource is created
 * once in the SignalWire dashboard and its ID is opaque; looking up by
 * display name keeps the wiring discoverable from the UI ("the resource
 * named `leadpilot-inbound`") and survives recreate-after-delete with
 * no env var rotation.
 */
export async function findFabricResourceIdByName(input: {
  name: string;
  type: 'swml_webhook' | 'cxml_webhook' | 'swml_script';
}): Promise<SwResult<string | null>> {
  const auth = basicAuth();
  const space = spaceUrl();
  if (!auth || !space) {
    return {
      ok: false,
      error:
        'SignalWire credentials missing. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_SPACE_URL.',
    };
  }
  let url: string | null = `https://${space}/api/fabric/resources?page_size=100`;
  while (url) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
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
    const json = (await res.json().catch(() => null)) as
      | {
          data?: Array<{ id: string; display_name: string | null; type: string }>;
          links?: { next: string | null };
        }
      | null;
    const match = json?.data?.find(
      (r) => r.type === input.type && r.display_name === input.name,
    );
    if (match) return { ok: true, data: match.id };
    url = json?.links?.next ?? null;
  }
  return { ok: true, data: null };
}

/**
 * Bind an IncomingPhoneNumber to a Fabric Calling Handler Resource.
 *
 * This is the *correct* way to wire inbound calls when the response is
 * SWML JSON. The legacy LaML `voice_url` field auto-creates a
 * `cxml_webhook` resource that expects XML — when our `/api/swml/...`
 * endpoint returns JSON, SignalWire's parser rejects the script and
 * the call dies in ~1s with no SIP code (the "fails silently" symptom
 * users were seeing). Binding to a `swml_webhook` resource via the
 * Relay REST phone_numbers endpoint avoids the cXML shim entirely.
 *
 * `call_handler: 'relay_script'` is the documented enum value for a
 * phone number whose calling handler is an SWML resource. Other values
 * (`swml_webhook`, `swml_script`, `relay_application`) are rejected by
 * the API for this purpose.
 */
export async function setIncomingPhoneNumberCallingHandler(input: {
  sid: string;
  resourceId: string;
}): Promise<SwResult<{ sid: string; calling_handler_resource_id: string | null }>> {
  const auth = basicAuth();
  const space = spaceUrl();
  if (!auth || !space) {
    return {
      ok: false,
      error:
        'SignalWire credentials missing. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_SPACE_URL.',
    };
  }
  const url = `https://${space}/api/relay/rest/phone_numbers/${input.sid}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        call_handler: 'relay_script',
        calling_handler_resource_id: input.resourceId,
      }),
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
  const json = (await res.json()) as {
    id?: string;
    calling_handler_resource_id?: string | null;
  };
  return {
    ok: true,
    data: {
      sid: json.id ?? input.sid,
      calling_handler_resource_id: json.calling_handler_resource_id ?? null,
    },
  };
}

/**
 * Clear an IncomingPhoneNumber's voice webhook + calling handler so
 * inbound calls stop reaching us. The Relay REST API requires a
 * non-null `call_handler` even when "disconnecting", so we fall back
 * to `laml_webhooks` with empty URLs — the carrier will still answer
 * the call but our handler chain is fully detached.
 */
export async function clearIncomingPhoneNumberCallingHandler(input: {
  sid: string;
}): Promise<SwResult<{ sid: string }>> {
  const auth = basicAuth();
  const space = spaceUrl();
  if (!auth || !space) {
    return {
      ok: false,
      error:
        'SignalWire credentials missing. Set SIGNALWIRE_PROJECT_ID, SIGNALWIRE_TOKEN, SIGNALWIRE_SPACE_URL.',
    };
  }
  const url = `https://${space}/api/relay/rest/phone_numbers/${input.sid}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        call_handler: 'laml_webhooks',
        call_request_url: '',
      }),
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
  return { ok: true, data: { sid: input.sid } };
}

/**
 * Update an IncomingPhoneNumber's voice webhook so inbound calls POST to our
 * SWML route. SignalWire's LaML API uses form-encoded body for updates.
 *
 * NOTE: Prefer `setIncomingPhoneNumberCallingHandler` for SWML JSON
 * endpoints. Setting `voice_url` here on a Resource-model account
 * silently creates a `cxml_webhook` (XML) resource which then rejects
 * our JSON responses. Kept for any path that genuinely needs LaML XML.
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
