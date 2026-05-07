'use client';

// Floating, draggable popup for an in-flight outbound call.
//
// Visual reference: GoHighLevel-style softphone — header strip with a
// drag handle + pin + minimize, an "Outgoing Call" headline with brand
// name + caller-id, local-time row, big avatar, contact name + number,
// status line ("Dialing…" / "0:42"), an 8-button action grid, and a
// big red "End Call".
//
// Behavior:
//   - Drag from the header strip; pinned state freezes position.
//   - Minimize collapses to a slim header bar (still draggable).
//   - Persists across in-app navigation because the provider lives at
//     the app-layout level, not on the /dialer page.
//   - All buttons are wired:
//       Mute        → session.audioMute / audioUnmute
//       Hold        → audioMute on local mic (no carrier MOH on browser)
//       Dial        → opens DTMF keypad → session.sendDigits
//       Notes       → inline textarea, saved to call.note via disposition
//       Scripts     → links to /scripts (read-only nudge for now)
//       Message     → links to /inbox/<lead> if lead known, else disabled
//       Blind/Warm  → disabled with a "coming soon" hint until SWML supports it
//       End call    → session.hangup → wrap_up

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useOutgoingCall } from './outgoing-call-provider';
import { DispositionPicker } from '@/components/dialer/disposition-picker';

const DEFAULT_W = 360;
const HEADER_PADDING = 24; // soft viewport inset so we never park off-screen

export function OutgoingCallPopup() {
  const {
    status,
    muted,
    onHold,
    dispositions,
    hangup,
    toggleMute,
    toggleHold,
    sendDigit,
    closeWrapUp,
    dismissError,
  } = useOutgoingCall();

  const visible = status.kind !== 'idle';
  const target = status.kind !== 'idle' ? status.target : null;

  // Position state (top/right anchored, like the screenshot). Stored as
  // {x, y} from top-left for free-form drag.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [activePanel, setActivePanel] = useState<null | 'notes' | 'dial'>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [dtmfBuffer, setDtmfBuffer] = useState('');

  // Default position: top-right corner with a small inset.
  useEffect(() => {
    if (visible && pos === null) {
      const x = Math.max(HEADER_PADDING, window.innerWidth - DEFAULT_W - HEADER_PADDING);
      const y = HEADER_PADDING;
      setPos({ x, y });
    }
    if (!visible) {
      // Reset transient panels when the popup closes so the next call
      // doesn't reopen the previous notes/dtmf scratchpad.
      setActivePanel(null);
      setNoteDraft('');
      setDtmfBuffer('');
      setMinimized(false);
    }
  }, [visible, pos]);

  // Keep the popup on-screen when the window resizes — otherwise a
  // window snap leaves the panel half off the right edge.
  useEffect(() => {
    function clamp() {
      setPos((p) => {
        if (!p) return p;
        const maxX = window.innerWidth - DEFAULT_W - HEADER_PADDING;
        const maxY = window.innerHeight - 64;
        return {
          x: Math.min(Math.max(0, p.x), Math.max(0, maxX)),
          y: Math.min(Math.max(0, p.y), Math.max(0, maxY)),
        };
      });
    }
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  // Pointer-based drag from the header.
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null,
  );
  const onHeaderPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (pinned) return;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: pos?.x ?? 0,
        baseY: pos?.y ?? 0,
      };
    },
    [pinned, pos],
  );
  const onHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const maxX = window.innerWidth - DEFAULT_W;
    const maxY = window.innerHeight - 60;
    const x = Math.min(Math.max(0, d.baseX + dx), Math.max(0, maxX));
    const y = Math.min(Math.max(0, d.baseY + dy), Math.max(0, maxY));
    setPos({ x, y });
  }, []);
  const onHeaderPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  }, []);

  // Hook MUST be called before any conditional return — otherwise the
  // hook count changes between renders (popup hidden vs visible) and
  // React throws "Rendered more hooks than during the previous render",
  // crashing the component the moment a call starts. That was the
  // root cause of the popup never appearing for outbound dials.
  const localTimeLabel = useNowClock();

  if (!visible || !target || !pos) return null;

  const phone = formatPhone(target.toNumber);
  const headline = target.leadName || 'Unknown';
  const initials = initialsFor(headline === 'Unknown' ? phone : headline);

  return (
    <div
      className="fixed z-[120] select-none"
      style={{ left: pos.x, top: pos.y, width: DEFAULT_W }}
    >
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55),0_4px_14px_-4px_rgba(0,0,0,0.45)] ring-1 ring-black/30">
        {/* Drag header */}
        <div
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
          onPointerCancel={onHeaderPointerUp}
          className={`flex items-center gap-2 border-b border-line bg-canvas/70 px-3 py-2 ${pinned ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
        >
          <span className="grid h-5 w-5 place-items-center text-txt-3">
            <DragDots />
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPinned((v) => !v)}
              className={`grid h-7 w-7 place-items-center rounded-full border ${pinned ? 'border-teal/60 bg-teal/10 text-teal' : 'border-line bg-surface text-txt-3 hover:bg-canvas'}`}
              title={pinned ? 'Unpin (allow drag)' : 'Pin (lock position)'}
              aria-label={pinned ? 'Unpin' : 'Pin'}
            >
              <PinIcon filled={pinned} />
            </button>
            <button
              type="button"
              onClick={() => setMinimized((v) => !v)}
              className="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-txt-3 hover:bg-canvas"
              title={minimized ? 'Expand' : 'Minimize'}
              aria-label={minimized ? 'Expand' : 'Minimize'}
            >
              {minimized ? <ExpandIcon /> : <MinimizeIcon />}
            </button>
          </div>
        </div>

        {/* Outgoing call badge row */}
        <div className="flex items-center gap-2 px-4 pt-3 pb-1">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-teal text-white">
            <ArrowUpRightIcon />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-txt-1">Outgoing Call</div>
            <div className="truncate text-[12px] text-txt-3">
              {target.brandName ?? 'LeadPilot'}
              {target.fromE164 ? ` · ${formatPhone(target.fromE164)}` : ''}
            </div>
          </div>
        </div>

        {/* Local time strip — matches the screenshot's timestamp banner */}
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-md border border-line bg-canvas px-3 py-1.5 text-[11.5px] text-txt-2">
          <ClockIcon />
          <span>{localTimeLabel}</span>
        </div>

        {!minimized && (
          <>
            {/* Avatar + name + status */}
            <div className="flex flex-col items-center gap-2 px-4 pt-5 pb-3">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-teal/15 text-[20px] font-semibold uppercase tracking-wide text-teal ring-1 ring-teal/40">
                {initials}
              </div>
              <div className="flex items-center gap-1.5 text-[15px] font-semibold text-txt-1">
                <ContactSmallIcon />
                <span>{headline}</span>
              </div>
              <div className="font-mono text-[13px] text-txt-2">{phone}</div>
              <div className="text-[12px] text-txt-3">
                {status.kind === 'connecting' && (
                  <span>
                    Dialing
                    <DotDotDot />
                  </span>
                )}
                {status.kind === 'in_call' && <Elapsed startedAt={status.startedAt} />}
                {status.kind === 'wrap_up' && 'Call ended — set a disposition'}
                {status.kind === 'error' && (
                  <span className="text-hp">{status.message}</span>
                )}
              </div>
            </div>

            {/* Action grid */}
            {(status.kind === 'in_call' || status.kind === 'connecting') && (
              <div className="grid grid-cols-4 gap-y-3 px-4 pb-2">
                <ActionButton
                  label="Message"
                  href={
                    target.leadId
                      ? (`/leads?lead=${target.leadId}` as unknown as import('next').Route)
                      : undefined
                  }
                  disabled={!target.leadId}
                  hint={target.leadId ? 'Open lead profile' : 'Lead not linked'}
                  icon={<MessageIcon />}
                />
                <ActionButton
                  label="Notes"
                  active={activePanel === 'notes'}
                  onClick={() =>
                    setActivePanel((p) => (p === 'notes' ? null : 'notes'))
                  }
                  icon={<NotesIcon />}
                />
                <ActionButton
                  label="Blind Transfer"
                  disabled
                  hint="Coming soon"
                  icon={<TransferIcon variant="blind" />}
                />
                <ActionButton
                  label="Warm Transfer"
                  disabled
                  hint="Coming soon"
                  icon={<TransferIcon variant="warm" />}
                />
                <ActionButton
                  label="Hold"
                  active={onHold}
                  onClick={() => void toggleHold()}
                  icon={<HoldIcon />}
                />
                <ActionButton
                  label="Mute"
                  active={muted}
                  onClick={() => void toggleMute()}
                  icon={<MuteIcon muted={muted} />}
                />
                <ActionButton
                  label="Scripts"
                  href={'/scripts' as const}
                  icon={<ScriptsIcon />}
                />
                <ActionButton
                  label="Dial"
                  active={activePanel === 'dial'}
                  onClick={() =>
                    setActivePanel((p) => (p === 'dial' ? null : 'dial'))
                  }
                  icon={<DialPadIcon />}
                />
              </div>
            )}

            {/* Notes inline panel */}
            {activePanel === 'notes' && status.kind === 'in_call' && (
              <div className="px-4 pb-2">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Note for this call (saved with disposition)…"
                  className="h-24 w-full resize-none rounded-md border border-line bg-canvas p-2 text-[12px] text-txt-1 outline-none focus:border-teal/60"
                />
                <div className="mt-1 text-[10.5px] text-txt-3">
                  Note attaches to this call when you set a disposition after hangup.
                </div>
              </div>
            )}

            {/* DTMF inline keypad */}
            {activePanel === 'dial' && status.kind === 'in_call' && (
              <div className="px-4 pb-3">
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
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map(
                    (d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          setDtmfBuffer((s) => (s + d).slice(0, 32));
                          void sendDigit(d);
                        }}
                        className="rounded-md border border-line bg-canvas py-1.5 font-mono text-[14px] hover:bg-surface-2 active:scale-95"
                      >
                        {d}
                      </button>
                    ),
                  )}
                </div>
              </div>
            )}

            {/* Wrap-up disposition */}
            {status.kind === 'wrap_up' && (
              <div className="border-t border-line bg-surface p-4">
                <DispositionPicker
                  callId={status.callId}
                  choices={dispositions}
                  initialNote={noteDraft || undefined}
                  onSaved={() => closeWrapUp()}
                />
              </div>
            )}

            {/* Error state */}
            {status.kind === 'error' && (
              <div className="border-t border-line bg-surface p-4">
                <button
                  type="button"
                  onClick={dismissError}
                  className="w-full rounded-xl border border-line bg-canvas py-2 text-[12.5px] font-semibold text-txt-2 hover:bg-surface-2"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* End call */}
            {(status.kind === 'in_call' || status.kind === 'connecting') && (
              <div className="px-4 pb-4 pt-1">
                <button
                  type="button"
                  onClick={() => void hangup()}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-hp py-3 text-[13.5px] font-semibold text-white shadow-[inset_0_-2px_0_0_rgba(0,0,0,0.22),0_4px_14px_-4px_rgba(225,29,72,0.5)] transition active:translate-y-[1px] hover:bg-hp/90"
                >
                  <EndCallIcon />
                  End Call
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// — Subcomponents ————————————————————————————————————————————————

function ActionButton(props: {
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  href?: import('next').Route;
  disabled?: boolean;
  active?: boolean;
  hint?: string;
}) {
  const base =
    'group flex flex-col items-center justify-center gap-1.5 text-[10.5px] text-txt-2';
  const ringBase =
    'grid h-11 w-11 place-items-center rounded-full border transition active:scale-95';
  const ringActive = props.active
    ? 'border-teal/60 bg-teal/10 text-teal'
    : 'border-line bg-canvas text-txt-2 hover:bg-surface-2';
  const ringDisabled = 'cursor-not-allowed border-line bg-canvas text-txt-3 opacity-50';
  const ring = `${ringBase} ${props.disabled ? ringDisabled : ringActive}`;

  const inner = (
    <>
      <span className={ring}>{props.icon}</span>
      <span className={props.disabled ? 'text-txt-3' : ''}>{props.label}</span>
    </>
  );
  if (props.href && !props.disabled) {
    return (
      <Link href={props.href} title={props.hint} className={base}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.hint}
      className={base}
    >
      {inner}
    </button>
  );
}

function Elapsed({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - startedAt) / 1000));
  useEffect(() => {
    const t = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(t);
  }, [startedAt]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span className="font-mono tabular-nums text-teal">
      {m}:{s.toString().padStart(2, '0')}
    </span>
  );
}

function useNowClock(): string {
  const [label, setLabel] = useState(() => formatNow());
  useEffect(() => {
    const t = window.setInterval(() => setLabel(formatNow()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return label;
}

function formatNow(): string {
  const d = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // Best-effort city label from the browser TZ — never blocks the popup
  // and gracefully degrades to the bare TZ identifier.
  let zone = '';
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) zone = ` Local Time (${tz.split('/').pop()?.replace(/_/g, ' ') ?? tz})`;
  } catch {
    /* ignore */
  }
  return `${time}${zone}`;
}

function DotDotDot() {
  return (
    <span className="inline-flex w-5 justify-around align-middle">
      <span className="animate-pulse" style={{ animationDelay: '0ms' }}>·</span>
      <span className="animate-pulse" style={{ animationDelay: '150ms' }}>·</span>
      <span className="animate-pulse" style={{ animationDelay: '300ms' }}>·</span>
    </span>
  );
}

function initialsFor(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed === 'Unknown') return 'UC';
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'UC';
}

function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  if (e164.startsWith('+1') && e164.length === 12) {
    return `${e164.slice(0, 2)}${e164.slice(2)}`.replace(
      /(\+1)(\d{3})(\d{3})(\d{4})/,
      '$1 ($2) $3-$4',
    );
  }
  return e164;
}

// — Icons ————————————————————————————————————————————————————————

function DragDots() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      {[2, 7, 12].flatMap((y) =>
        [3, 8, 13].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" />),
      )}
    </svg>
  );
}
function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 17v5" />
      <path d="M5 8l3 8h8l3-8-7-5z" />
    </svg>
  );
}
function MinimizeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14h6v6" />
      <path d="M20 10h-6V4" />
    </svg>
  );
}
function ExpandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 3h-6v6" />
      <path d="M3 21h6v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  );
}
function ArrowUpRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function ContactSmallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="12" cy="11" r="3" />
      <path d="M7 18c1-2 3-3 5-3s4 1 5 3" />
    </svg>
  );
}
function MessageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z" />
    </svg>
  );
}
function NotesIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 7h6M9 11h6M9 15h4" />
      <circle cx="17.5" cy="17.5" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
function TransferIcon({ variant }: { variant: 'blind' | 'warm' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92V20a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2 4.18 2 2 0 0 1 4 2h3.09a1 1 0 0 1 1 .75c.13.96.36 1.9.7 2.81a1 1 0 0 1-.27 1.05L7.21 8a16 16 0 0 0 6 6l1.39-1.31a1 1 0 0 1 1.05-.27c.91.34 1.85.57 2.81.7a1 1 0 0 1 .75 1z" />
      {variant === 'warm' ? <path d="M19 4l3 3-3 3" /> : <path d="M16 7l5-3-1 5" />}
    </svg>
  );
}
function HoldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function MuteIcon({ muted }: { muted: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {muted && <path d="M2 2l20 20" />}
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}
function ScriptsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <circle cx="14" cy="17" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
function DialPadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      {[5, 12, 19].flatMap((y) =>
        [5, 12, 19].map((x) => <rect key={`${x}-${y}`} x={x - 1.6} y={y - 1.6} width="3.2" height="3.2" rx="0.8" />),
      )}
    </svg>
  );
}
function EndCallIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92V20a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2 4.18 2 2 0 0 1 4 2h3.09a1 1 0 0 1 1 .75c.13.96.36 1.9.7 2.81a1 1 0 0 1-.27 1.05L7.21 8a16 16 0 0 0 6 6l1.39-1.31a1 1 0 0 1 1.05-.27c.91.34 1.85.57 2.81.7a1 1 0 0 1 .75 1z" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
