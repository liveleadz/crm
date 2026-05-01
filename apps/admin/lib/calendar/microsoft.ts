import 'server-only';
import { ensureFreshMicrosoftToken } from '@/lib/oauth/microsoft';

const BASE = 'https://graph.microsoft.com/v1.0';

export type MsCalListItem = {
  id: string;
  name: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
};

export type MsEventInput = {
  summary: string;
  description?: string | null;
  location?: string | null;
  startIso: string;
  endIso: string | null;
};

export type MsEvent = {
  id: string;
  '@odata.etag'?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  location?: { displayName?: string };
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isCancelled?: boolean;
  '@removed'?: { reason?: string };
};

async function authedFetch(token: string, url: string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

export async function listMyCalendars(memberId: string): Promise<MsCalListItem[]> {
  const token = await ensureFreshMicrosoftToken(memberId);
  if (!token) throw new Error('No Microsoft token for member');
  const res = await authedFetch(token, `${BASE}/me/calendars?$top=100`);
  if (!res.ok) throw new Error(`ms list calendars: ${res.status}`);
  const json = (await res.json()) as { value?: MsCalListItem[] };
  return json.value ?? [];
}

function eventBody(e: MsEventInput) {
  return {
    subject: e.summary,
    body: e.description
      ? { contentType: 'text', content: e.description }
      : undefined,
    location: e.location ? { displayName: e.location } : undefined,
    start: { dateTime: e.startIso, timeZone: 'UTC' },
    end: { dateTime: e.endIso ?? e.startIso, timeZone: 'UTC' },
  };
}

export async function pushEvent(input: {
  memberId: string;
  extCalendarId: string;
  event: MsEventInput;
}): Promise<{ id: string; etag?: string }> {
  const token = await ensureFreshMicrosoftToken(input.memberId);
  if (!token) throw new Error('No Microsoft token for member');
  const res = await authedFetch(
    token,
    `${BASE}/me/calendars/${encodeURIComponent(input.extCalendarId)}/events`,
    { method: 'POST', body: JSON.stringify(eventBody(input.event)) },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ms push event: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as MsEvent;
  return { id: json.id, etag: json['@odata.etag'] };
}

export async function patchEvent(input: {
  memberId: string;
  extCalendarId: string;
  extEventId: string;
  event: MsEventInput;
  etag?: string | null;
}): Promise<{ id: string; etag?: string }> {
  const token = await ensureFreshMicrosoftToken(input.memberId);
  if (!token) throw new Error('No Microsoft token for member');
  const res = await authedFetch(
    token,
    `${BASE}/me/calendars/${encodeURIComponent(input.extCalendarId)}/events/${encodeURIComponent(input.extEventId)}`,
    {
      method: 'PATCH',
      headers: input.etag ? { 'If-Match': input.etag } : {},
      body: JSON.stringify(eventBody(input.event)),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ms patch event: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as MsEvent;
  return { id: json.id, etag: json['@odata.etag'] };
}

export async function deleteEvent(input: {
  memberId: string;
  extCalendarId: string;
  extEventId: string;
}): Promise<void> {
  const token = await ensureFreshMicrosoftToken(input.memberId);
  if (!token) throw new Error('No Microsoft token for member');
  const res = await authedFetch(
    token,
    `${BASE}/me/calendars/${encodeURIComponent(input.extCalendarId)}/events/${encodeURIComponent(input.extEventId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const body = await res.text().catch(() => '');
    throw new Error(`ms delete event: ${res.status} ${body.slice(0, 200)}`);
  }
}

// /me/calendars/{id}/calendarView/delta — Graph requires startDateTime+endDateTime
// on the first request; afterwards the deltaLink carries the window forward.
export async function listDelta(input: {
  memberId: string;
  extCalendarId: string;
  syncToken: string | null;
}): Promise<{ events: MsEvent[]; nextSyncToken: string | null }> {
  const token = await ensureFreshMicrosoftToken(input.memberId);
  if (!token) throw new Error('No Microsoft token for member');

  const events: MsEvent[] = [];
  let nextSyncToken: string | null = null;

  let next: string;
  if (input.syncToken) {
    // syncToken is the full deltaLink URL stored as-is.
    next = input.syncToken;
  } else {
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 86400_000);
    const params = new URLSearchParams({
      startDateTime: now.toISOString(),
      endDateTime: horizon.toISOString(),
    });
    next = `${BASE}/me/calendars/${encodeURIComponent(input.extCalendarId)}/calendarView/delta?${params.toString()}`;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await authedFetch(token, next, {
      headers: { Prefer: 'odata.maxpagesize=100' },
    });
    if (res.status === 410) {
      // delta token expired — restart with a fresh window.
      return listDelta({ ...input, syncToken: null });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ms list delta: ${res.status} ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      value?: MsEvent[];
      '@odata.nextLink'?: string;
      '@odata.deltaLink'?: string;
    };
    if (json.value) events.push(...json.value);
    if (json['@odata.nextLink']) {
      next = json['@odata.nextLink'];
      continue;
    }
    if (json['@odata.deltaLink']) {
      nextSyncToken = json['@odata.deltaLink'];
    }
    break;
  }

  return { events, nextSyncToken };
}
