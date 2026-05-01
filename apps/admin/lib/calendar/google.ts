import 'server-only';
import { ensureFreshGoogleToken } from '@/lib/oauth/google';

const BASE = 'https://www.googleapis.com/calendar/v3';

export type GoogleCalListItem = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
};

export type GoogleEventInput = {
  summary: string;
  description?: string | null;
  location?: string | null;
  startIso: string;
  endIso: string | null;
};

export type GoogleEvent = {
  id: string;
  status: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
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

export async function listMyCalendars(memberId: string): Promise<GoogleCalListItem[]> {
  const token = await ensureFreshGoogleToken(memberId);
  if (!token) throw new Error('No Google token for member');
  const res = await authedFetch(token, `${BASE}/users/me/calendarList`);
  if (!res.ok) throw new Error(`google list calendars: ${res.status}`);
  const json = (await res.json()) as { items?: GoogleCalListItem[] };
  return json.items ?? [];
}

function eventBody(e: GoogleEventInput) {
  return {
    summary: e.summary,
    description: e.description ?? undefined,
    location: e.location ?? undefined,
    start: { dateTime: e.startIso },
    end: { dateTime: e.endIso ?? e.startIso },
  };
}

export async function pushEvent(input: {
  memberId: string;
  extCalendarId: string;
  event: GoogleEventInput;
}): Promise<{ id: string; etag?: string }> {
  const token = await ensureFreshGoogleToken(input.memberId);
  if (!token) throw new Error('No Google token for member');
  const res = await authedFetch(
    token,
    `${BASE}/calendars/${encodeURIComponent(input.extCalendarId)}/events`,
    { method: 'POST', body: JSON.stringify(eventBody(input.event)) },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`google push event: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as GoogleEvent;
  return { id: json.id, etag: json.etag };
}

export async function patchEvent(input: {
  memberId: string;
  extCalendarId: string;
  extEventId: string;
  event: GoogleEventInput;
  etag?: string | null;
}): Promise<{ id: string; etag?: string }> {
  const token = await ensureFreshGoogleToken(input.memberId);
  if (!token) throw new Error('No Google token for member');
  const res = await authedFetch(
    token,
    `${BASE}/calendars/${encodeURIComponent(input.extCalendarId)}/events/${encodeURIComponent(input.extEventId)}`,
    {
      method: 'PATCH',
      headers: input.etag ? { 'If-Match': input.etag } : {},
      body: JSON.stringify(eventBody(input.event)),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`google patch event: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as GoogleEvent;
  return { id: json.id, etag: json.etag };
}

export async function deleteEvent(input: {
  memberId: string;
  extCalendarId: string;
  extEventId: string;
}): Promise<void> {
  const token = await ensureFreshGoogleToken(input.memberId);
  if (!token) throw new Error('No Google token for member');
  const res = await authedFetch(
    token,
    `${BASE}/calendars/${encodeURIComponent(input.extCalendarId)}/events/${encodeURIComponent(input.extEventId)}`,
    { method: 'DELETE' },
  );
  // 410 = already gone, treat as success.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new Error(`google delete event: ${res.status} ${body.slice(0, 200)}`);
  }
}

// Walks pages of events. On first sync (no syncToken), seeds with a
// 30-day forward window — Google requires either timeMin or syncToken.
export async function listDelta(input: {
  memberId: string;
  extCalendarId: string;
  syncToken: string | null;
}): Promise<{ events: GoogleEvent[]; nextSyncToken: string | null }> {
  const token = await ensureFreshGoogleToken(input.memberId);
  if (!token) throw new Error('No Google token for member');

  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;
  let firstParams = true;

  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '100',
    });
    if (pageToken) params.set('pageToken', pageToken);
    else if (input.syncToken) params.set('syncToken', input.syncToken);
    else if (firstParams) {
      const now = new Date();
      const horizon = new Date(now.getTime() + 30 * 86400_000);
      params.set('timeMin', now.toISOString());
      params.set('timeMax', horizon.toISOString());
    }
    firstParams = false;

    const res = await authedFetch(
      token,
      `${BASE}/calendars/${encodeURIComponent(input.extCalendarId)}/events?${params.toString()}`,
    );
    if (res.status === 410) {
      // syncToken expired — fall back to a fresh window.
      return listDelta({ ...input, syncToken: null });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`google list events: ${res.status} ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    if (json.items) events.push(...json.items);
    pageToken = json.nextPageToken;
    if (json.nextSyncToken) nextSyncToken = json.nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}
