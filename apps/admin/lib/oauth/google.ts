import 'server-only';
import { createAdminClient } from '@leadpilot/db/admin';
import { redirectBase } from './state';

// Google OAuth2 with offline access for refresh tokens. Phase 1 requests
// only Calendar scope; Phase 2 will append Gmail send/read scopes by
// re-prompting the user with `prompt=consent` to re-grant the broader
// scope set.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export type GoogleTokenSet = {
  access_token: string;
  refresh_token?: string | null;
  expires_at: number; // ms since epoch
  scope: string;
  account_email: string | null;
};

function clientId() {
  const v = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!v) throw new Error('GOOGLE_OAUTH_CLIENT_ID not configured');
  return v;
}
function clientSecret() {
  const v = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error('GOOGLE_OAUTH_CLIENT_SECRET not configured');
  return v;
}
function redirectUri() {
  return `${redirectBase()}/api/oauth/google/callback`;
}

export function authorizeUrl(scopes: string[], state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent', // ensure we get a refresh_token even on re-grant
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<GoogleTokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`google token exchange failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };
  const account_email = await fetchUserEmail(json.access_token).catch(() => null);
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    expires_at: Date.now() + json.expires_in * 1000,
    scope: json.scope,
    account_email,
  };
}

export async function refresh(refreshToken: string): Promise<Omit<GoogleTokenSet, 'account_email'>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`google refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    scope: string;
    refresh_token?: string;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? refreshToken,
    expires_at: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { email?: string };
  return json.email ?? null;
}

// Returns a fresh access token for `memberId`, refreshing in place when
// the stored token is within 60s of expiry. Persists the refreshed token
// back to members.email_oauth so concurrent callers don't all re-refresh.
export async function ensureFreshGoogleToken(memberId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: m } = await supabase
    .from('members')
    .select('email_provider, email_oauth')
    .eq('id', memberId)
    .maybeSingle();
  if (!m || m.email_provider !== 'google') return null;
  const oauth = m.email_oauth as GoogleTokenSet | null;
  if (!oauth?.access_token) return null;
  if (oauth.expires_at && oauth.expires_at - Date.now() > 60_000) {
    return oauth.access_token;
  }
  if (!oauth.refresh_token) return null;
  const fresh = await refresh(oauth.refresh_token);
  const merged: GoogleTokenSet = {
    ...oauth,
    ...fresh,
  };
  await supabase.from('members').update({ email_oauth: merged }).eq('id', memberId);
  return fresh.access_token;
}
