'use client';

import { useState, useTransition } from 'react';
import { startCall } from '@/app/actions/dialer';

const KEYS: { value: string; sub?: string }[] = [
  { value: '1' },
  { value: '2', sub: 'ABC' },
  { value: '3', sub: 'DEF' },
  { value: '4', sub: 'GHI' },
  { value: '5', sub: 'JKL' },
  { value: '6', sub: 'MNO' },
  { value: '7', sub: 'PQRS' },
  { value: '8', sub: 'TUV' },
  { value: '9', sub: 'WXYZ' },
  { value: '*' },
  { value: '0', sub: '+' },
  { value: '#' },
];

export function DialPad() {
  const [number, setNumber] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'error'; message: string }>(
    { kind: 'idle' },
  );
  const [calling, setCalling] = useState(false);
  const [, startTransition] = useTransition();

  function press(k: string) {
    setNumber((n) => (n + k).slice(0, 20));
  }

  function backspace() {
    setNumber((n) => n.slice(0, -1));
  }

  function call() {
    if (!number.trim() || calling) return;
    setCalling(true);
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const res = await startCall({ toNumber: number });
      setCalling(false);
      if (!res.ok) setStatus({ kind: 'error', message: res.error });
    });
  }

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4">
        <input
          type="tel"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') call();
          }}
          placeholder="Enter phone number"
          className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-center font-mono text-[18px] tracking-wide outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => press(k.value)}
            className="grid h-14 place-items-center rounded-xl border border-line bg-canvas hover:bg-surface-2 active:scale-95"
          >
            <span className="font-mono text-[18px] font-medium">{k.value}</span>
            {k.sub && <span className="text-[9px] text-txt-3">{k.sub}</span>}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={backspace}
          disabled={!number}
          className="grid h-12 w-12 place-items-center rounded-xl border border-line text-txt-3 hover:bg-canvas disabled:opacity-30"
          aria-label="Backspace"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={call}
          disabled={!number.trim() || calling}
          className="flex-1 rounded-xl bg-teal py-3 text-[13px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {calling ? 'Connecting…' : 'Call'}
        </button>
      </div>
      {status.kind === 'error' && (
        <div className="mt-3 rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] leading-snug text-hp">
          {status.message}
        </div>
      )}
    </div>
  );
}
