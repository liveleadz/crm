import 'server-only';
import { ensureFreshGoogleToken } from '@/lib/oauth/google';

// Gmail API v1 client. Surfaces the four operations the CRM needs:
//   * sendMessage  — POST /users/me/messages/send (raw RFC822)
//   * getMessage   — GET  /users/me/messages/{id}?format=full
//   * listHistory  — GET  /users/me/history?startHistoryId=...
//   * getProfile   — GET  /users/me/profile (for initial historyId seed)
//
// All calls go through ensureFreshGoogleToken so an expired access_token
// is auto-refreshed without surfacing to callers.

const BASE = 'https://gmail.googleapis.com/gmail/v1';

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart;
};
export type GmailHistoryRecord = {
  id: string;
  messages?: { id: string; threadId: string }[];
  messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
  messagesDeleted?: { message: { id: string; threadId: string } }[];
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

export async function getProfile(memberId: string): Promise<{
  emailAddress: string;
  historyId: string;
}> {
  const token = await ensureFreshGoogleToken(memberId);
  if (!token) throw new Error('No Google token for member');
  const res = await authedFetch(token, `${BASE}/users/me/profile`);
  if (!res.ok) throw new Error(`gmail profile: ${res.status}`);
  return (await res.json()) as { emailAddress: string; historyId: string };
}

// Encodes a UTF-8 string as base64url, the format Gmail's `raw` field
// expects. Newlines must be CRLF per RFC 5322.
function base64url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export type SendMessageInput = {
  memberId: string;
  fromAddr: string;
  fromName?: string | null;
  toAddrs: string[];
  ccAddrs?: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  // RFC822 references for replies. Pass the prior message's Message-ID
  // (with angle brackets) so Gmail keeps the thread intact.
  inReplyTo?: string | null;
  references?: string[];
  // Pass when replying to keep the message in the same Gmail threadId.
  threadId?: string | null;
};

export type SendMessageResult = {
  id: string;
  threadId: string;
  rfc822MessageId: string;
};

function quoteHeaderName(name: string): string {
  // Avoid quoting in display name unless it contains chars that need it.
  if (/[",;:<>@\[\]\\]/.test(name)) return `"${name.replace(/"/g, '\\"')}"`;
  return name;
}

function buildAddress(addr: string, name?: string | null): string {
  if (!name?.trim()) return addr;
  return `${quoteHeaderName(name.trim())} <${addr}>`;
}

// Strips HTML tags + entities to a usable plain-text fallback. Conservative —
// keeps line breaks for <br> and block elements so the result reads naturally.
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildRfc822(input: SendMessageInput, rfc822MessageId: string): string {
  const headers: string[] = [];
  headers.push(`Date: ${new Date().toUTCString()}`);
  headers.push(`From: ${buildAddress(input.fromAddr, input.fromName)}`);
  headers.push(`Reply-To: ${buildAddress(input.fromAddr, input.fromName)}`);
  headers.push(`To: ${input.toAddrs.join(', ')}`);
  if (input.ccAddrs?.length) headers.push(`Cc: ${input.ccAddrs.join(', ')}`);
  headers.push(`Subject: ${input.subject.replace(/[\r\n]/g, ' ')}`);
  headers.push(`Message-ID: <${rfc822MessageId}>`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references?.length) headers.push(`References: ${input.references.join(' ')}`);
  headers.push('MIME-Version: 1.0');

  // Always ship a text/plain alternative — single-part HTML is a common
  // spam signal for one-to-one mail.
  const bodyText = input.bodyText?.trim() ? input.bodyText : htmlToPlainText(input.bodyHtml);

  if (bodyText && input.bodyHtml) {
    const boundary = `lp_${Math.random().toString(36).slice(2)}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      bodyText,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 7bit',
      '',
      input.bodyHtml,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return headers.join('\r\n') + '\r\n' + body;
  }

  headers.push('Content-Type: text/html; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 7bit');
  return headers.join('\r\n') + '\r\n\r\n' + input.bodyHtml;
}

// Generates a unique RFC 5322 Message-ID. The right-hand side uses the
// sender's domain so DMARC alignment isn't broken; this is just the
// header value, not the SMTP envelope.
function newRfc822MessageId(fromAddr: string): string {
  const domain = fromAddr.split('@')[1] || 'leadpilot.local';
  const rand = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;
  return `${rand}@${domain}`;
}

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const token = await ensureFreshGoogleToken(input.memberId);
  if (!token) throw new Error('No Google token for member');
  const rfc822MessageId = newRfc822MessageId(input.fromAddr);
  const raw = base64url(buildRfc822(input, rfc822MessageId));
  const body: { raw: string; threadId?: string } = { raw };
  if (input.threadId) body.threadId = input.threadId;
  const res = await authedFetch(token, `${BASE}/users/me/messages/send`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`gmail send: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id: string; threadId: string };
  return { id: json.id, threadId: json.threadId, rfc822MessageId };
}

export async function getMessage(input: {
  memberId: string;
  messageId: string;
  format?: 'full' | 'metadata' | 'minimal';
}): Promise<GmailMessage> {
  const token = await ensureFreshGoogleToken(input.memberId);
  if (!token) throw new Error('No Google token for member');
  const fmt = input.format ?? 'full';
  const res = await authedFetch(
    token,
    `${BASE}/users/me/messages/${encodeURIComponent(input.messageId)}?format=${fmt}`,
  );
  if (!res.ok) throw new Error(`gmail get message: ${res.status}`);
  return (await res.json()) as GmailMessage;
}

// Walks paginated /history. Returns the records plus the new historyId
// to checkpoint. When startHistoryId is too old (404 / 410), Gmail rejects
// the call — the caller should fall back to getProfile() to reseed.
export async function listHistory(input: {
  memberId: string;
  startHistoryId: string;
}): Promise<{ records: GmailHistoryRecord[]; nextHistoryId: string | null }> {
  const token = await ensureFreshGoogleToken(input.memberId);
  if (!token) throw new Error('No Google token for member');
  const records: GmailHistoryRecord[] = [];
  let pageToken: string | undefined;
  let nextHistoryId: string | null = null;

  do {
    const params = new URLSearchParams({
      startHistoryId: input.startHistoryId,
      historyTypes: 'messageAdded',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await authedFetch(
      token,
      `${BASE}/users/me/history?${params.toString()}`,
    );
    if (res.status === 404 || res.status === 410) {
      // historyId expired — caller needs to reseed via getProfile.
      return { records: [], nextHistoryId: null };
    }
    if (!res.ok) throw new Error(`gmail history: ${res.status}`);
    const json = (await res.json()) as {
      history?: GmailHistoryRecord[];
      nextPageToken?: string;
      historyId?: string;
    };
    if (json.history) records.push(...json.history);
    if (json.historyId) nextHistoryId = json.historyId;
    pageToken = json.nextPageToken;
  } while (pageToken);

  return { records, nextHistoryId };
}

// Helpers to project a fetched GmailMessage into our domain shape.
export function findHeader(part: GmailPart | undefined, name: string): string | null {
  if (!part?.headers) return null;
  const h = part.headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

function decodeBase64Url(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

// Walks the MIME tree and returns the first text/plain and text/html bodies.
export function extractBodies(payload: GmailPart | undefined): {
  text: string | null;
  html: string | null;
} {
  let text: string | null = null;
  let html: string | null = null;
  function walk(p: GmailPart | undefined) {
    if (!p) return;
    const data = p.body?.data;
    if (data) {
      const decoded = decodeBase64Url(data);
      if (p.mimeType === 'text/plain' && !text) text = decoded;
      else if (p.mimeType === 'text/html' && !html) html = decoded;
    }
    if (p.parts) for (const sub of p.parts) walk(sub);
  }
  walk(payload);
  return { text, html };
}

// Splits an RFC 5322 address-list header into bare addresses. Best-effort —
// for inbound display we just need something to render and match against.
export function parseAddressList(value: string | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const part of value.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/<([^>]+)>/);
    out.push((m?.[1] ?? t).toLowerCase());
  }
  return out;
}
