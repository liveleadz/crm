'use client';

import { useState, useTransition } from 'react';
import { setInitialPassword } from '@/app/actions/welcome';

const MIN_LEN = 8;

export function SetPasswordForm() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LEN) {
      setError(`Password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    startTransition(async () => {
      const res = await setInitialPassword(password);
      if (res && !res.ok) setError(res.error);
      // On success the action calls redirect() which throws; we never reach here.
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        type="password"
        required
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password"
        minLength={MIN_LEN}
        className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
      />
      <input
        type="password"
        required
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm password"
        minLength={MIN_LEN}
        className="w-full rounded border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-teal"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded bg-teal px-3 py-2 text-sm font-medium text-teal-fg disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Set password'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <p className="text-[11px] text-txt-3">
        After saving you'll sign in with your email and this password.
      </p>
    </form>
  );
}
