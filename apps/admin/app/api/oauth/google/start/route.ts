import { NextResponse } from 'next/server';
import { createServerClient } from '@leadpilot/db/server';
import { authorizeUrl, scopesForIntent } from '@/lib/oauth/google';
import { signState, type OAuthIntent } from '@/lib/oauth/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const intentRaw = url.searchParams.get('intent') || 'calendar';
  const intent: OAuthIntent =
    intentRaw === 'email' ? 'email' : 'calendar';
  const returnTo = url.searchParams.get('return_to') || '/settings/connections';

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', returnTo);
    return NextResponse.redirect(login);
  }

  const scopes = scopesForIntent(intent);
  const state = signState({ memberId: user.id, intent, provider: 'google', returnTo });
  return NextResponse.redirect(authorizeUrl(scopes, state));
}
