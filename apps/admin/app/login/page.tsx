'use client';

import { createBrowserClient } from '@leadpilot/db/client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get('error');
  const welcome = searchParams.get('welcome') === '1';
  const next = searchParams.get('next') ?? '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(callbackError);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    window.location.replace(next);
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <h1 className="mb-1 text-lg font-semibold">LeadPilot Admin</h1>
        <p className="mb-6 text-sm text-txt-2">Sign in to your account.</p>
        {welcome && (
          <div className="mb-4 rounded border border-teal/40 bg-teal/10 px-3 py-2 text-[12px] text-txt-1">
            Password set. Sign in with your email and new password to finish setup.
          </div>
        )}
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
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-teal px-3 py-2 text-sm font-medium text-teal-fg disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>
        <div className="mt-4 flex items-center justify-between text-xs text-txt-2">
          <Link href="/forgot-password" className="hover:text-txt">
            Forgot password?
          </Link>
          <Link href="/signup" className="hover:text-txt">
            Create account
          </Link>
        </div>
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
