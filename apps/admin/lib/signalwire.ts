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
