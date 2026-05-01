import 'server-only';
import { createAdminClient } from '@leadpilot/db/admin';
import { redirectBase } from './state';

// Microsoft identity platform v2 (Microsoft Graph). Uses the `common`
// tenant by default so personal + work accounts both work; override via
// MICROSOFT_OAUTH_TENANT for a single-tenant app registration.

const MS_TENANT = () => process.env.MICROSOFT_OAUTH_TENANT || 'common';
const AUTH_URL = () =>
  `https://login.microsoftonline.com/${MS_TENANT()}/oauth2/v2.0/authorize`;
const TOKEN_URL = () => `https://login.microsoftonline.com/${MS_TENANT()}/oauth2/v2.0/token`;
const ME_URL = 'https://graph.microsoft.com/v1.0/me';

export const MICROSOFT_CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'offline_access',
  'Calendars.ReadWrite',
];

export type MicrosoftTokenSet = {
  access_token: string;
  refresh_token?: string | null;
  expires_at: number;
  scope: string;
  account_email: string | null;
};

function clientId() {
  const v = process.env.MICROSOFT_OAUTH_CLIENT_ID;
  if (!v) throw new Error('MICROSOFT_OAUTH_CLIENT_ID not configured');
  return v;
}
function clientSecret() {
  const v = process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error('MICROSOFT_OAUTH_CLIENT_SECRET not configured');
  return v;
}
function redirectUri() {
  return `${redirectBase()}/api/oauth/microsoft/callback`;
}

export function authorizeUrl(scopes: string[], state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: scopes.join(' '),
    response_mode: 'query',
    state,
    prompt: 'consent',
  });
  return `${AUTH_URL()}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<MicrosoftTokenSet> {
  const res = await fetch(TOKEN_URL(), {
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
    throw new Error(`microsoft token exchange failed: ${res.status} ${body.slice(0, 200)}`);
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

export async function refresh(
  refreshToken: string,
): Promise<Omit<MicrosoftTokenSet, 'account_email'>> {
  const res = await fetch(TOKEN_URL(), {
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
    throw new Error(`microsoft refresh failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? refreshToken,
    expires_at: Date.now() + json.expires_in * 1000,
    scope: json.scope,
  };
}

async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  const json = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return json.mail ?? json.userPrincipalName ?? null;
}

export async function ensureFreshMicrosoftToken(memberId: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data: m } = await supabase
    .from('members')
    .select('email_provider, email_oauth')
    .eq('id', memberId)
    .maybeSingle();
  if (!m || m.email_provider !== 'microsoft') return null;
  const oauth = m.email_oauth as MicrosoftTokenSet | null;
  if (!oauth?.access_token) return null;
  if (oauth.expires_at && oauth.expires_at - Date.now() > 60_000) {
    return oauth.access_token;
  }
  if (!oauth.refresh_token) return null;
  const fresh = await refresh(oauth.refresh_token);
  const merged: MicrosoftTokenSet = { ...oauth, ...fresh };
  await supabase.from('members').update({ email_oauth: merged }).eq('id', memberId);
  return fresh.access_token;
}
