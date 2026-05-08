'use client';

// In-app popup that fires when an inbound call is ringing, then stays
// up through the in-call timer, then surfaces the disposition picker
// after hangup so no inbound slips through without an outcome.
//
// Visual is intentionally restrained: caller info only on the ringing
// view (name + phone), no verbose labels. Depth comes from layered
// shadow + 1px ring, not glow.

import { useEffect, useState } from 'react';
import { useIncomingCall } from './incoming-call-provider';
import { DispositionPicker } from '@/components/dialer/disposition-picker';
import { InCallScripts } from '@/components/dialer/in-call-scripts';

export function IncomingCallPopup() {
  const {
    pending,
    status,
    muted,
    dispositions,
    answer,
    reject,
    hangup,
    toggleMute,
    sendDigit,
    transfer,
    closeWrapUp,
  } = useIncomingCall();

  const visible =
    pending !== null ||
    status.kind === 'connecting' ||
    status.kind === 'in_call' ||
    status.kind === 'wrap_up';

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex justify-center px-4 sm:top-6">
      <div className="pointer-events-auto w-full max-w-sm origin-top animate-[incoming-call-in_240ms_cubic-bezier(0.2,0.9,0.3,1.2)] rounded-2xl border border-line bg-surface shadow-[0_10px_40px_-10px_rgba(0,0,0,0.45),0_2px_8px_-2px_rgba(0,0,0,0.4)] ring-1 ring-black/40">
        {pending && status.kind !== 'in_call' && status.kind !== 'wrap_up' ? (
          <PreAnswer
            from={pending.fromNumber}
            leadName={pending.leadName}
            connecting={status.kind === 'connecting'}
            error={status.kind === 'error' ? status.message : null}
            onAnswer={answer}
            onReject={reject}
          />
        ) : status.kind === 'in_call' ? (
          <InCall
            startedAt={status.startedAt}
            muted={muted}
            leadName={pending?.leadName ?? null}
            fromNumber={pending?.fromNumber ?? null}
            onHangup={hangup}
            onToggleMute={toggleMute}
            onSendDigit={sendDigit}
            onTransfer={transfer}
          />
        ) : status.kind === 'wrap_up' ? (
          <WrapUp
            callId={status.callId}
            dispositions={dispositions}
            onClose={closeWrapUp}
          />
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
  leadName,
  connecting,
  error,
  onAnswer,
  onReject,
}: {
  from: string;
  leadName: string | null;
  connecting: boolean;
  error: string | null;
  onAnswer: () => void;
  onReject: () => void;
}) {
  const headline = leadName || formatPhone(from);
  const subline = leadName ? formatPhone(from) : null;

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
          <div className="truncate text-[14.5px] font-semibold text-txt-1">{headline}</div>
          {subline && (
            <div className="truncate font-mono text-[11.5px] text-txt-3">{subline}</div>
          )}
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

// Mirrors the OutgoingCallPopup in-call action surface: 5 wired buttons
// (Mute / Notes / Script / Dial / Transfer), inline keypad + transfer
// panel, and a big red End Call. The inbound popup keeps its compact
// top-center placement; the action grid + panels match outbound 1:1 so
// the rep gets the same controls regardless of call direction.
function InCall({
  startedAt,
  muted,
  leadName,
  fromNumber,
  onHangup,
  onToggleMute,
  onSendDigit,
  onTransfer,
}: {
  startedAt: number;
  muted: boolean;
  leadName: string | null;
  fromNumber: string | null;
  onHangup: () => void;
  onToggleMute: () => Promise<void>;
  onSendDigit: (d: string) => Promise<void>;
  onTransfer: (target: string) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  const [activePanel, setActivePanel] = useState<
    null | 'notes' | 'dial' | 'transfer' | 'script'
  >(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [dtmfBuffer, setDtmfBuffer] = useState('');
  const [transferTarget, setTransferTarget] = useState('');
  const [transferState, setTransferState] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

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
    <div className="flex flex-col">
      {/* Timer header */}
      <div className="flex items-center gap-3 px-4 pt-4">
        <div className="grid h-10 w-10 place-items-center rounded-full bg-teal/15 text-teal ring-1 ring-teal/40">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </div>
        <div className="flex-1 font-mono text-[14px] tabular-nums text-txt-1">
          {mm}:{ss}
        </div>
      </div>

      {/* 5-button action grid — same set as outbound popup */}
      <div className="grid grid-cols-5 gap-x-1 gap-y-3 px-4 pt-3">
        <ActionMini
          label="Mute"
          active={muted}
          onClick={() => void onToggleMute()}
          icon={<MuteIcon muted={muted} />}
        />
        <ActionMini
          label="Notes"
          active={activePanel === 'notes'}
          onClick={() => setActivePanel((p) => (p === 'notes' ? null : 'notes'))}
          icon={<NotesIcon />}
        />
        <ActionMini
          label="Script"
          active={activePanel === 'script'}
          onClick={() => setActivePanel((p) => (p === 'script' ? null : 'script'))}
          icon={<ScriptsIcon />}
        />
        <ActionMini
          label="Dial"
          active={activePanel === 'dial'}
          onClick={() => setActivePanel((p) => (p === 'dial' ? null : 'dial'))}
          icon={<DialPadIcon />}
        />
        <ActionMini
          label="Transfer"
          active={activePanel === 'transfer'}
          onClick={() => setActivePanel((p) => (p === 'transfer' ? null : 'transfer'))}
          icon={<TransferIcon />}
        />
      </div>

      {activePanel === 'notes' && (
        <div className="px-4 pt-3">
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Note for this call (saved with disposition)…"
            className="h-20 w-full resize-none rounded-md border border-line bg-canvas p-2 text-[12px] text-txt-1 outline-none focus:border-teal/60"
          />
          <div className="mt-1 text-[10.5px] text-txt-3">
            Note attaches to this call when you set a disposition after hangup.
          </div>
        </div>
      )}

      {activePanel === 'script' && (
        <div className="max-h-72 overflow-y-auto px-4 pt-3">
          <InCallScripts lead={{ leadName, phone: fromNumber }} />
        </div>
      )}

      {activePanel === 'dial' && (
        <div className="px-4 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[12px] text-txt-2">
              {dtmfBuffer || 'Send DTMF tones'}
            </span>
            {dtmfBuffer && (
              <button
                type="button"
                onClick={() => setDtmfBuffer('')}
                className="text-[10.5px] text-txt-3 hover:text-txt-1"
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => {
                  setDtmfBuffer((s) => (s + d).slice(0, 32));
                  void onSendDigit(d);
                }}
                className="rounded-md border border-line bg-canvas py-1.5 font-mono text-[14px] hover:bg-surface-2 active:scale-95"
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {activePanel === 'transfer' && (
        <div className="px-4 pt-3">
          <div className="mb-1.5 text-[11.5px] text-txt-3">
            Blind transfer — current call ends and the lead is reconnected to
            the typed number.
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="tel"
              value={transferTarget}
              onChange={(e) => {
                setTransferTarget(e.target.value);
                if (transferState.kind === 'error') {
                  setTransferState({ kind: 'idle' });
                }
              }}
              placeholder="+1 555 123 4567"
              inputMode="tel"
              autoComplete="off"
              className="flex-1 rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-[12.5px] text-txt-1 outline-none focus:border-teal/60"
            />
            <button
              type="button"
              disabled={transferState.kind === 'pending' || !transferTarget.trim()}
              onClick={async () => {
                setTransferState({ kind: 'pending' });
                const res = await onTransfer(transferTarget.trim());
                if (!res.ok) {
                  setTransferState({ kind: 'error', message: res.error });
                } else {
                  setTransferState({ kind: 'idle' });
                  setActivePanel(null);
                }
              }}
              className="rounded-md border border-teal bg-teal px-3 py-1.5 text-[12px] font-semibold text-white transition active:translate-y-[1px] hover:bg-teal/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {transferState.kind === 'pending' ? 'Transferring…' : 'Transfer'}
            </button>
          </div>
          {transferState.kind === 'error' && (
            <div className="mt-1 text-[11px] text-hp">{transferState.message}</div>
          )}
        </div>
      )}

      <div className="px-4 pb-4 pt-3">
        <button
          type="button"
          onClick={onHangup}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-hp py-2.5 text-[13px] font-semibold text-white shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.22),0_4px_14px_-4px_rgba(225,29,72,0.5)] transition active:translate-y-[1px] hover:bg-hp/90"
        >
          Hang up
        </button>
      </div>
    </div>
  );
}

function ActionMini(props: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  const ring = props.active
    ? 'border-teal/60 bg-teal/10 text-teal'
    : 'border-line bg-canvas text-txt-2 hover:bg-surface-2';
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="group flex flex-col items-center justify-center gap-1.5 text-[10.5px] text-txt-2"
    >
      <span
        className={`grid h-10 w-10 place-items-center rounded-full border transition active:scale-95 ${ring}`}
      >
        {props.icon}
      </span>
      <span>{props.label}</span>
    </button>
  );
}

function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {muted && <path d="M2 2l20 20" />}
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}
function NotesIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </svg>
  );
}
function ScriptsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
function DialPadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
      {[5, 12, 19].flatMap((y) =>
        [5, 12, 19].map((x) => (
          <rect key={`${x}-${y}`} x={x - 1.5} y={y - 1.5} width="3" height="3" rx="0.6" />
        )),
      )}
    </svg>
  );
}
function TransferIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92V20a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2 4.18 2 2 0 0 1 4 2h3.09a1 1 0 0 1 1 .75c.13.96.36 1.9.7 2.81a1 1 0 0 1-.27 1.05L7.21 8a16 16 0 0 0 6 6l1.39-1.31a1 1 0 0 1 1.05-.27c.91.34 1.85.57 2.81.7a1 1 0 0 1 .75 1z" />
      <path d="M16 7l5-3-1 5" />
    </svg>
  );
}

function WrapUp({
  callId,
  dispositions,
  onClose,
}: {
  callId: string;
  dispositions: import('@/components/dialer/disposition-picker').DispositionChoice[];
  onClose: () => void;
}) {
  return (
    <div className="p-4">
      <DispositionPicker
        callId={callId}
        choices={dispositions}
        onSaved={onClose}
        onCancel={onClose}
      />
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
