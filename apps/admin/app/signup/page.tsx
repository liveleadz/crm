'use client';

import { createBrowserClient } from '@leadpilot/db/client';
import Link from 'next/link';
import { useState } from 'react';

export default function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createBrowserClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName || null },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // If email confirmation is required, session is null and user must click the link.
    if (!data.session) {
      setNeedsConfirm(true);
      return;
    }
    window.location.replace('/dashboard');
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <h1 className="mb-1 text-lg font-semibold">Create account</h1>
        <p className="mb-6 text-sm text-txt-2">Sign up for LeadPilot Admin.</p>
        {needsConfirm ? (
          <p className="text-sm text-txt-2">
            Check your inbox at <span className="text-txt">{email}</span> and click the
            confirmation link to finish signing up.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="text"
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name (optional)"
              className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
            />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@leadpilot.com"
              className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
            />
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (min 8 chars)"
              className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-teal px-3 py-2 text-sm font-medium text-teal-fg disabled:opacity-50"
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </form>
        )}
        <div className="mt-4 text-xs text-txt-2">
          Already have an account?{' '}
          <Link href="/login" className="hover:text-txt">
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
