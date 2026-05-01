import { NextResponse } from 'next/server';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { exchangeCode } from '@/lib/oauth/google';
import { verifyState } from '@/lib/oauth/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateToken = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error || !code || !stateToken) {
    return errorRedirect(request, error || 'missing code/state');
  }
  const state = verifyState(stateToken);
  if (!state || state.provider !== 'google') {
    return errorRedirect(request, 'invalid_state');
  }

  // Confirm the current session matches the member who initiated the flow.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state.memberId) {
    return errorRedirect(request, 'session_mismatch');
  }

  let tokens;
  try {
    tokens = await exchangeCode(code);
  } catch (e) {
    return errorRedirect(request, (e as Error).message.slice(0, 120));
  }

  // Use admin client to write the OAuth blob — members.email_oauth is
  // protected by RLS for self-update in theory, but service-role keeps
  // the path simple and avoids a per-environment RLS audit.
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('members')
    .select('oauth_scopes')
    .eq('id', state.memberId)
    .maybeSingle();
  const scopes = new Set(existing?.oauth_scopes ?? []);
  scopes.add(state.intent);

  await admin
    .from('members')
    .update({
      email_provider: 'google',
      email_oauth: tokens as unknown as never,
      oauth_scopes: Array.from(scopes),
    })
    .eq('id', state.memberId);

  const ret = new URL(state.returnTo, request.url);
  ret.searchParams.set('connected', 'google');
  return NextResponse.redirect(ret);
}

function errorRedirect(request: Request, message: string) {
  const ret = new URL('/settings/connections', request.url);
  ret.searchParams.set('error', message);
  return NextResponse.redirect(ret);
}
