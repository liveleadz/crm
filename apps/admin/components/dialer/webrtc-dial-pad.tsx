'use client';

// Keypad UI for ad-hoc outbound dials. The actual SignalWire client +
// in-call lifecycle live in OutgoingCallProvider (mounted at the app
// layout level), so the floating popup persists across navigation and
// every page in the app can trigger a dial via useOutgoingCall().start.
//
// This component is a thin keypad: collect a number, hand it to the
// provider, and disable the Call button while a call is already
// in flight. Brand name + caller-ID are passed through so the popup
// header can render "BrandName · +1…" without a server round-trip.

import { useState } from 'react';
import { useOutgoingCall } from '@/components/outgoing-call/outgoing-call-provider';

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
  initialNumber?: string | null;
  initialLeadId?: string | null;
  // dispositions kept on the props for backwards-compat with the page
  // route — the provider already owns them, so the keypad ignores it.
  dispositions: unknown;
};

export function WebRTCDialPad({
  brandName,
  fromE164,
  initialNumber,
  initialLeadId,
}: Props) {
  const [number, setNumber] = useState(initialNumber ?? '');
  const { status, start } = useOutgoingCall();
  const busy = status.kind !== 'idle';

  function press(k: string) {
    setNumber((n) => (n + k).slice(0, 20));
  }
  function backspace() {
    setNumber((n) => n.slice(0, -1));
  }

  async function placeCall() {
    if (!number.trim() || busy) return;
    await start({
      toNumber: number,
      leadId: initialLeadId ?? null,
      brandName,
      fromE164,
    });
  }

  const callDisabled = !number.trim() || busy || !fromE164;

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
            if (e.key === 'Enter' && !busy) void placeCall();
          }}
          disabled={busy}
          placeholder="Enter phone number"
          className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-center font-mono text-[18px] tracking-wide outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20 disabled:opacity-60"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => press(k.value)}
            disabled={busy}
            className="grid h-14 place-items-center rounded-xl border border-line bg-canvas hover:bg-surface-2 active:scale-95 disabled:opacity-50"
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
          disabled={!number || busy}
          className="grid h-12 w-12 place-items-center rounded-xl border border-line text-txt-3 hover:bg-canvas disabled:opacity-30"
          aria-label="Backspace"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => void placeCall()}
          disabled={callDisabled}
          className="flex-1 rounded-xl bg-teal py-3 text-[13px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {busy ? 'Call in progress…' : 'Call'}
        </button>
      </div>
    </div>
  );
}
