import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Round-trip payload that travels through the OAuth `state` parameter.
// HMAC-signed so the callback can trust it without a session round-trip
// to the database. Bound to a single member id and a 10-minute window.

export type OAuthIntent = 'calendar' | 'email';
export type OAuthProvider = 'google';

export type StatePayload = {
  memberId: string;
  intent: OAuthIntent;
  provider: OAuthProvider;
  returnTo: string;
  // Issued-at, ms since epoch.
  iat: number;
};

const TTL_MS = 10 * 60 * 1000;

function secret() {
  const s = process.env.OAUTH_STATE_SECRET;
  if (!s || s.length < 16) {
    throw new Error('OAUTH_STATE_SECRET is not configured (needs ≥16 chars).');
  }
  return s;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}
function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function signState(input: Omit<StatePayload, 'iat'>): string {
  const payload: StatePayload = { ...input, iat: Date.now() };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(token: string | null | undefined): StatePayload | null {
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(createHmac('sha256', secret()).update(body).digest());
  const sigBuf = b64urlDecode(sig);
  const expBuf = b64urlDecode(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  let payload: StatePayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as StatePayload;
  } catch {
    return null;
  }
  if (typeof payload.iat !== 'number' || Date.now() - payload.iat > TTL_MS) return null;
  if (!payload.memberId || !payload.intent || !payload.provider) return null;
  return payload;
}

export function redirectBase(): string {
  return (
    process.env.OAUTH_REDIRECT_BASE ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3002'
  ).replace(/\/$/, '');
}
