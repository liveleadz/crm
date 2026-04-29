'use client';

import { createBrowserClient } from '@leadpilot/db/client';
import Link from 'next/link';
import { useState } from 'react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <h1 className="mb-1 text-lg font-semibold">Reset password</h1>
        <p className="mb-6 text-sm text-txt-2">
          We&rsquo;ll email you a link to set a new password.
        </p>
        {sent ? (
          <p className="text-sm text-txt-2">
            If an account exists for <span className="text-txt">{email}</span>, a reset link is on
            the way.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@leadpilot.com"
              className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-teal px-3 py-2 text-sm font-medium text-teal-fg disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </form>
        )}
        <div className="mt-4 text-xs text-txt-2">
          <Link href="/login" className="hover:text-txt">
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
