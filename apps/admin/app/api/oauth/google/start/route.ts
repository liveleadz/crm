import { NextResponse } from 'next/server';
import { createServerClient } from '@leadpilot/db/server';
import { authorizeUrl, GOOGLE_CALENDAR_SCOPES } from '@/lib/oauth/google';
import { signState, type OAuthIntent } from '@/lib/oauth/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const intent = (url.searchParams.get('intent') || 'calendar') as OAuthIntent;
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

  // Phase 1 only requests calendar scopes. Phase 2 will branch on intent
  // to add gmail.* scopes.
  const scopes = GOOGLE_CALENDAR_SCOPES;
  const state = signState({ memberId: user.id, intent, provider: 'google', returnTo });
  return NextResponse.redirect(authorizeUrl(scopes, state));
}
