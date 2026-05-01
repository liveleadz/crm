import { NextResponse } from 'next/server';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { exchangeCode, intentsFromGrantedScope } from '@/lib/oauth/google';
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
  // Project the granted scope string back to our internal scope tokens.
  // Source of truth is what Google actually granted, not what we asked for —
  // a user can untick a scope on the consent screen.
  const granted = intentsFromGrantedScope(tokens.scope);
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('members')
    .select('oauth_scopes')
    .eq('id', state.memberId)
    .maybeSingle();
  // Re-grants override prior scope state for this provider — if the user
  // re-runs Connect and unchecks email, we drop 'email' from the set.
  // We still preserve any non-google internal scopes (none today, but
  // safe for future providers).
  const prior = new Set(existing?.oauth_scopes ?? []);
  prior.delete('calendar');
  prior.delete('email');
  for (const s of granted) prior.add(s);

  await admin
    .from('members')
    .update({
      email_provider: 'google',
      email_oauth: tokens as unknown as never,
      oauth_scopes: Array.from(prior),
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
