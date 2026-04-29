// HMAC-signed short-lived tokens for in-flight WebRTC dials.
//
// Flow:
//   1. /dialer-v2 server action creates a `calls` row and signs a token
//      containing { callId, from, to, exp }.
//   2. Browser dials `/private/leadpilot-dialer?t=<token>`.
//   3. SignalWire fetches our SWML webhook with the dialed address;
//      the webhook verifies the token and returns <Connect> SWML.
//
// We use HMAC-SHA256 over a base64url-encoded JSON payload. No DB lookup
// is required to validate, so the webhook stays fast and stateless.

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

export function signDialToken(payload: DialTokenPayload): string {
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyDialToken(token: string): DialTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = b64url(createHmac('sha256', getSecret()).update(body).digest());
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  let payload: DialTokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8')) as DialTokenPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}
