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

  // Project the granted scope string back to our internal scope tokens.
  // Source of truth is what Google actually granted, not what we asked for —
  // a user can untick a scope on the consent screen.
  const granted = intentsFromGrantedScope(tokens.scope);
  const accountEmail = (tokens.account_email ?? '').toLowerCase();
  if (!accountEmail) {
    return errorRedirect(request, 'no_account_email');
  }

  const admin = createAdminClient();

  // 1. Upsert into member_oauth_accounts. Merge granted scopes with the
  //    row's existing scopes so re-granting calendar doesn't drop email
  //    (or vice-versa) when the same Google account is reconnected.
  const { data: existingAccount } = await admin
    .from('member_oauth_accounts')
    .select('id, scopes')
    .eq('member_id', state.memberId)
    .eq('provider', 'google')
    .eq('account_email', accountEmail)
    .maybeSingle();
  const accountScopes = new Set(existingAccount?.scopes ?? []);
  for (const s of granted) accountScopes.add(s);

  await admin.from('member_oauth_accounts').upsert(
    {
      member_id: state.memberId,
      provider: 'google',
      account_email: accountEmail,
      oauth: tokens as unknown as never,
      scopes: Array.from(accountScopes),
    },
    { onConflict: 'member_id,provider,account_email' },
  );

  // 2. Decide whether to mirror this grant into legacy members.email_oauth.
  //    Email-send + email-pull still read that single blob, so we keep it
  //    in sync with the "primary" account. Mirror when:
  //      - This is the member's only account row, OR
  //      - It matches the account already mirrored in members.email_oauth.
  //    Adding a second distinct account leaves the primary untouched.
  const { data: allAccounts } = await admin
    .from('member_oauth_accounts')
    .select('account_email')
    .eq('member_id', state.memberId)
    .eq('provider', 'google');
  const accountEmails = (allAccounts ?? [])
    .map((r) => (r.account_email ?? '').toLowerCase())
    .filter(Boolean);
  const isOnlyAccount = accountEmails.length <= 1;

  const { data: memberRow } = await admin
    .from('members')
    .select('email_oauth, oauth_scopes')
    .eq('id', state.memberId)
    .maybeSingle();
  const mirroredEmail =
    ((memberRow?.email_oauth as { account_email?: string | null } | null)?.account_email ?? '').toLowerCase();
  const matchesPrimary = mirroredEmail !== '' && mirroredEmail === accountEmail;

  if (isOnlyAccount || matchesPrimary) {
    const prior = new Set(memberRow?.oauth_scopes ?? []);
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
  }

  const ret = new URL(state.returnTo, request.url);
  ret.searchParams.set('connected', 'google');
  return NextResponse.redirect(ret);
}

function errorRedirect(request: Request, message: string) {
  const ret = new URL('/settings/connections', request.url);
  ret.searchParams.set('error', message);
  return NextResponse.redirect(ret);
}
