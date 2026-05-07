// Post-invite landing page. The invitee arrives here with a Supabase
// session already on the cookie (set by `/auth/callback`). They pick a
// password; the action below stamps it on auth.users, signs them out,
// and bounces them to /login so they can verify the credential works.
//
// If the cookie is missing/expired, send them to the login page with a
// hint so they can ask for a fresh invite link.

import { redirect } from 'next/navigation';
import { createServerClient } from '@leadpilot/db/server';
import { SetPasswordForm } from './set-password-form';

export const dynamic = 'force-dynamic';

export default async function WelcomePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?error=Invite%20link%20expired.%20Ask%20for%20a%20new%20one.');
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <h1 className="mb-1 text-lg font-semibold">Welcome to LeadPilot</h1>
        <p className="mb-6 text-sm text-txt-2">
          Set a password for <span className="font-medium text-txt-1">{user.email}</span>. You'll
          use it to sign in from now on.
        </p>
        <SetPasswordForm />
      </div>
    </main>
  );
}
