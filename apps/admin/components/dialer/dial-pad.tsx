'use client';

import { useState, useTransition } from 'react';
import { setMyMobile, startCall } from '@/app/actions/dialer';

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

type Props = {
  brandName: string | null;
  fromE164: string | null;
  mobilePhone: string | null;
};

type Status =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'ringing'; signalwireCallId: string }
  | { kind: 'error'; message: string };

export function DialPad({ brandName, fromE164, mobilePhone }: Props) {
  const [number, setNumber] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [, startTransition] = useTransition();
  const [needsMobile, setNeedsMobile] = useState(!mobilePhone);
  const [mobileDraft, setMobileDraft] = useState(mobilePhone ?? '');
  const [mobileSaved, setMobileSaved] = useState(mobilePhone);
  const [mobileSaving, setMobileSaving] = useState(false);

  function press(k: string) {
    setNumber((n) => (n + k).slice(0, 20));
  }

  function backspace() {
    setNumber((n) => n.slice(0, -1));
  }

  function call() {
    if (!number.trim() || status.kind === 'connecting' || status.kind === 'ringing') return;
    setStatus({ kind: 'connecting' });
    startTransition(async () => {
      const res = await startCall({ toNumber: number });
      if (!res.ok) {
        if (res.code === 'mobile_missing' || res.code === 'mobile_invalid') {
          setNeedsMobile(true);
        }
        setStatus({ kind: 'error', message: res.error });
        return;
      }
      setStatus({ kind: 'ringing', signalwireCallId: res.signalwireCallId });
    });
  }

  function saveMobile(e: React.FormEvent) {
    e.preventDefault();
    setMobileSaving(true);
    startTransition(async () => {
      const res = await setMyMobile({ mobile: mobileDraft });
      setMobileSaving(false);
      if (!res.ok) {
        setStatus({ kind: 'error', message: res.error });
        return;
      }
      setMobileSaved(mobileDraft);
      setNeedsMobile(false);
      setStatus({ kind: 'idle' });
    });
  }

  if (needsMobile) {
    return (
      <div className="mx-auto w-full max-w-sm rounded-2xl border border-line bg-surface p-5">
        <h2 className="mb-1 text-[14px] font-semibold">Set your mobile number</h2>
        <p className="mb-4 text-[12px] text-txt-3">
          The dialer rings your mobile first, then bridges to the lead with your brand
          caller-ID. Required only the first time.
        </p>
        <form onSubmit={saveMobile} className="space-y-3">
          <input
            type="tel"
            value={mobileDraft}
            onChange={(e) => setMobileDraft(e.target.value)}
            placeholder="+1 555 123 4567"
            className="w-full rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-[14px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <button
            type="submit"
            disabled={mobileSaving || !mobileDraft.trim()}
            className="w-full rounded-xl bg-teal py-3 text-[13px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {mobileSaving ? 'Saving…' : 'Save and continue'}
          </button>
          {status.kind === 'error' && (
            <p className="text-[11.5px] text-hp">{status.message}</p>
          )}
        </form>
      </div>
    );
  }

  const callDisabled =
    !number.trim() ||
    status.kind === 'connecting' ||
    status.kind === 'ringing' ||
    !fromE164;

  return (
    <div className="mx-auto w-full max-w-sm rounded-2xl border border-line bg-surface p-5">
      {fromE164 ? (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-line bg-canvas px-3 py-2 text-[11.5px]">
          <span className="text-txt-3">Caller ID</span>
          <span className="font-mono text-txt">{fromE164}</span>
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] text-hp">
          No outbound number assigned to {brandName ?? 'this brand'}.
        </div>
      )}
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
          disabled={callDisabled}
          className="flex-1 rounded-xl bg-teal py-3 text-[13px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {status.kind === 'connecting'
            ? 'Connecting…'
            : status.kind === 'ringing'
              ? 'Ringing your mobile…'
              : 'Call'}
        </button>
      </div>
      {status.kind === 'ringing' && (
        <div className="mt-3 rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-[11.5px] leading-snug text-teal">
          Pick up the call on {mobileSaved ?? 'your mobile'} — we&rsquo;ll bridge you to the lead.
        </div>
      )}
      {status.kind === 'error' && (
        <div className="mt-3 rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] leading-snug text-hp">
          {status.message}
        </div>
      )}
      <p className="mt-3 text-center text-[10.5px] text-txt-3">
        Mobile: <span className="font-mono">{mobileSaved}</span> ·{' '}
        <button
          type="button"
          onClick={() => setNeedsMobile(true)}
          className="underline hover:text-txt"
        >
          change
        </button>
      </p>
    </div>
  );
}
