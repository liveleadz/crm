// HMAC-signed short-lived tokens for in-flight WebRTC dials.
//
// Flow:
//   1. /dialer server action creates a `calls` row and signs a dial token
//      containing { callId, from, to, exp }.
//   2. Browser dials the SWML webhook resource; SignalWire forwards the
//      token via userVariables and we verify it server-side.
//   3. The same secret is reused to sign recording-callback tokens so
//      SignalWire's status_url POST can be authenticated against the row.
//
// HMAC-SHA256 over a base64url-encoded JSON payload. No DB lookup is
// required to validate, so the webhook stays fast and stateless.

import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

export type DialTokenPayload = {
  callId: string;
  from: string; // brand caller-ID, E.164
  to: string; // lead phone, E.164
  exp: number; // unix seconds
};

function getSecret(): string {
  const secret = process.env.LAML_WEBHOOK_SECRET;
  if (!secret) throw new Error('LAML_WEBHOOK_SECRET not set');
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function signToken(payload: object): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

function verifyToken<T extends { exp: number }>(token: string): T | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = b64url(createHmac('sha256', getSecret()).update(body).digest());
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  let payload: T;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as T;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

export function signDialToken(payload: DialTokenPayload): string {
  return signToken(payload);
}

export function verifyDialToken(token: string): DialTokenPayload | null {
  return verifyToken<DialTokenPayload>(token);
}

// Path-based recording signature. Used as the `status_url` on `record_call`
// — SignalWire rejects the dot-separated JWT-style token in a query string
// ("Parameter \"status_url\" in method \"record_call\" has invalid value"),
// so we sign just the callId and embed both as path segments. Short URL,
// no query string, no separator chars SignalWire dislikes.
export function signRecordingPath(callId: string): string {
  return createHmac('sha256', getSecret()).update(callId).digest('hex').slice(0, 16);
}

export function verifyRecordingPath(callId: string, sig: string): boolean {
  if (!callId || !sig || sig.length !== 16) return false;
  const expected = signRecordingPath(callId);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Same construction as the recording path, namespaced with a "cs:" prefix so
// a leaked recording sig can't be replayed as a status sig.
export function signCallStatusPath(callId: string): string {
  return createHmac('sha256', getSecret())
    .update(`cs:${callId}`)
    .digest('hex')
    .slice(0, 16);
}

export function verifyCallStatusPath(callId: string, sig: string): boolean {
  if (!callId || !sig || sig.length !== 16) return false;
  const expected = signCallStatusPath(callId);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
