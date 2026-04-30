'use client';

// In-app popup that fires when an inbound call is ringing for this member.
// Two states: pre-answer (Answer / Reject) and in-call (timer + Hang up).
// Designed for depth: layered shadow, 1px high-contrast border, a subtle
// gradient on the avatar, slight scale-in on mount. No glass / glow —
// keeps consistent with the platform's neobrutalism-minimal feel while
// still feeling alive and important.

import { useEffect, useState } from 'react';
import { useIncomingCall } from './incoming-call-provider';

export function IncomingCallPopup() {
  const { pending, status, answer, reject, hangup } = useIncomingCall();

  // Show the popup if there's a pending call OR we're connected/connecting
  // to one (so the agent has a hang-up affordance during the call).
  const visible =
    pending !== null || status.kind === 'connecting' || status.kind === 'in_call';

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4 sm:top-6">
      <div
        className="pointer-events-auto w-full max-w-sm origin-top animate-[incoming-call-in_240ms_cubic-bezier(0.2,0.9,0.3,1.2)] rounded-2xl border border-line bg-surface shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45),0_2px_8px_-2px_rgba(0,0,0,0.4)] ring-1 ring-black/40"
      >
        {pending && status.kind !== 'in_call' ? (
          <PreAnswer
            from={pending.fromNumber}
            to={pending.toNumber}
            leadName={pending.leadName}
            connecting={status.kind === 'connecting'}
            error={status.kind === 'error' ? status.message : null}
            onAnswer={answer}
            onReject={reject}
          />
        ) : status.kind === 'in_call' ? (
          <InCall startedAt={status.startedAt} onHangup={hangup} />
        ) : null}
      </div>
      <style jsx global>{`
        @keyframes incoming-call-in {
          from {
            transform: scale(0.92) translateY(-8px);
            opacity: 0;
          }
          to {
            transform: scale(1) translateY(0);
            opacity: 1;
          }
        }
        @keyframes incoming-call-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(20, 184, 166, 0.55); }
          50% { box-shadow: 0 0 0 12px rgba(20, 184, 166, 0); }
        }
      `}</style>
    </div>
  );
}

function PreAnswer({
  from,
  to,
  leadName,
  connecting,
  error,
  onAnswer,
  onReject,
}: {
  from: string;
  to: string;
  leadName: string | null;
  connecting: boolean;
  error: string | null;
  onAnswer: () => void;
  onReject: () => void;
}) {
  const headline = leadName || formatPhone(from);
  const subline = leadName ? formatPhone(from) : 'Unknown caller';

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <div
          className="grid h-12 w-12 place-items-center rounded-full bg-canvas text-[15px] font-semibold uppercase text-teal ring-1 ring-teal/40"
          style={{ animation: 'incoming-call-pulse 1.4s ease-out infinite' }}
        >
          {initials(headline)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-teal">
            Inbound call · ringing
          </div>
          <div className="mt-0.5 truncate text-[14.5px] font-semibold text-txt-1">{headline}</div>
          <div className="truncate font-mono text-[11.5px] text-txt-3">
            {subline}
            {to ? <span className="text-txt-3"> → {formatPhone(to)}</span> : null}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] text-hp">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onReject}
          disabled={connecting}
          className="rounded-xl border border-line bg-canvas px-3 py-2 text-[12.5px] font-semibold text-txt-2 shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.18)] transition active:translate-y-[1px] active:shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.22)] hover:border-hp/40 hover:text-hp disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reject
        </button>
        <button
          type="button"
          onClick={onAnswer}
          disabled={connecting}
          className="rounded-xl border border-teal bg-teal px-3 py-2 text-[12.5px] font-semibold text-white shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.22),0_4px_14px_-4px_rgba(20,184,166,0.6)] transition active:translate-y-[1px] active:shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.22)] hover:bg-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {connecting ? 'Connecting…' : 'Answer'}
        </button>
      </div>
    </div>
  );
}

function InCall({ startedAt, onHangup }: { startedAt: number; onHangup: () => void }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  useEffect(() => {
    const t = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(t);
  }, [startedAt]);
  const mm = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const ss = (elapsed % 60).toString().padStart(2, '0');
  return (
    <div className="flex items-center gap-3 p-4">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-teal/15 text-teal ring-1 ring-teal/40">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      </div>
      <div className="flex-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-teal">
          In call
        </div>
        <div className="mt-0.5 font-mono text-[14px] tabular-nums text-txt-1">
          {mm}:{ss}
        </div>
      </div>
      <button
        type="button"
        onClick={onHangup}
        className="rounded-xl border border-hp bg-hp px-3 py-2 text-[12.5px] font-semibold text-white shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.22),0_4px_14px_-4px_rgba(225,29,72,0.5)] transition active:translate-y-[1px] hover:bg-hp/90"
      >
        Hang up
      </button>
    </div>
  );
}

function initials(text: string): string {
  const parts = text.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function formatPhone(e164: string): string {
  if (!e164) return '';
  if (e164.startsWith('+1') && e164.length === 12) {
    return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  }
  return e164;
}
