'use server';

import { createAdminClient } from '@leadpilot/db/admin';
import { createServerClient } from '@leadpilot/db/server';
import { redirect } from 'next/navigation';

export async function signOut() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}

// Username login alias. Supabase Auth only knows about emails, so the
// login page accepts either a username or an email and we resolve the
// username -> email here (RLS-bypassed via the admin client) before
// the client calls supabase.auth.signInWithPassword. Returns a
// generic error for unknown usernames so the form doesn't leak which
// usernames exist.
export async function resolveLoginIdentifier(
  identifier: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const value = identifier.trim();
  if (!value) return { ok: false as const, error: 'Enter your username or email' };
  if (value.includes('@')) return { ok: true as const, email: value.toLowerCase() };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('members')
    .select('email')
    .eq('username', value.toLowerCase())
    .maybeSingle();
  if (error) return { ok: false as const, error: 'Login failed. Try again.' };
  if (!data?.email) return { ok: false as const, error: 'Invalid username or password' };
  return { ok: true as const, email: data.email };
}
