'use server';

// First-login password setup. Called from /welcome after the invitee has
// followed the magic link and `/auth/callback` set their session cookie.
//
// Flow:
//   1. Verify a session is on the cookie (the invitee).
//   2. updateUser({ password }) — also marks email_confirmed_at on Supabase
//      side if it wasn't already, since the invite link itself confirmed
//      the email.
//   3. signOut() so the magic-link session cannot be reused; invitee must
//      now sign in with email + password they just set. This proves the
//      credential works before the manager hears any complaints.
//   4. redirect('/login?welcome=1') — the login page surfaces a one-line
//      success banner.

import { redirect } from 'next/navigation';
import { createServerClient } from '@leadpilot/db/server';

const MIN_LEN = 8;

type Result = { ok: false; error: string };

export async function setInitialPassword(password: string): Promise<Result | void> {
  if (typeof password !== 'string' || password.length < MIN_LEN) {
    return { ok: false, error: `Password must be at least ${MIN_LEN} characters.` };
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Your invite link has expired. Ask for a new one.' };
  }

  const { error: updErr } = await supabase.auth.updateUser({ password });
  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  // Drop the magic-link session — the invitee must now log in fresh with
  // their email + the password they just set. Don't fail the whole flow
  // if signOut errors; updateUser already succeeded so the credential
  // works.
  await supabase.auth.signOut();

  redirect('/login?welcome=1');
}
