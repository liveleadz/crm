'use client';

import { createBrowserClient } from '@leadpilot/db/client';
import { useEffect, useState } from 'react';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createBrowserClient();
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(Boolean(data.session));
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    window.location.replace('/dashboard');
  }

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <h1 className="mb-1 text-lg font-semibold">Set new password</h1>
        <p className="mb-6 text-sm text-txt-2">Choose a new password for your account.</p>
        {hasSession === false ? (
          <p className="text-sm text-red-400">
            This reset link is invalid or has expired. Request a new one from the forgot-password
            page.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
            />
            <input
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm password"
              className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
            />
            <button
              type="submit"
              disabled={loading || hasSession === null}
              className="w-full rounded bg-teal px-3 py-2 text-sm font-medium text-teal-fg disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Save new password'}
            </button>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
