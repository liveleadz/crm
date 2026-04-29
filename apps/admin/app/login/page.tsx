'use client';

import { createBrowserClient } from '@leadpilot/db/client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get('error');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(callbackError);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <h1 className="mb-1 text-lg font-semibold">LeadPilot Admin</h1>
        <p className="mb-6 text-sm text-txt-2">Sign in with a magic link.</p>
        {sent ? (
          <p className="text-sm text-txt-2">Check your inbox at <span className="text-txt">{email}</span>.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="email"
              required
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
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
