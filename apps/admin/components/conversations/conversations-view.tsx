'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getEmailThreadMessages, sendEmail } from '@/app/actions/email';
import { searchLeads } from '@/app/actions/leads';
import { refreshActiveThread } from '@/app/actions/email-refresh';
import { useVisiblePoll } from '@/lib/use-visible-poll';
import type { BrandEmailThreadRow } from '@/lib/email/threads';

type Message = {
  id: string;
  direction: 'outbound' | 'inbound';
  fromAddr: string | null;
  toAddrs: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string;
};

type LeadSuggestion = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

function formatWhen(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatFull(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ConversationsView({
  threads,
  scope,
  initialThreadId,
  currentMemberId,
  canSend,
  fromAddr,
  signature,
}: {
  threads: BrandEmailThreadRow[];
  scope: 'mine' | 'all';
  initialThreadId: string | null;
  currentMemberId: string | null;
  canSend: boolean;
  fromAddr: string | null;
  signature: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  // null = browse threads. 'compose' = new-email shell with To/Subject inputs.
  const [composeMode, setComposeMode] = useState<boolean>(false);

  const messagesScrollRef = useRef<HTMLDivElement>(null);

  async function reloadActive(): Promise<Message[]> {
    if (!activeId) return [];
    setLoading(true);
    const res = await getEmailThreadMessages({ threadId: activeId });
    setMessages(res.messages as Message[]);
    setLoading(false);
    return res.messages as Message[];
  }

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    getEmailThreadMessages({ threadId: activeId }).then((res) => {
      setMessages(res.messages as Message[]);
      setLoading(false);
      // Scroll to newest after the messages render.
      requestAnimationFrame(() => {
        messagesScrollRef.current?.scrollTo({
          top: messagesScrollRef.current.scrollHeight,
        });
      });
    });
  }, [activeId]);

  // Poll the open thread every 10s while the tab is visible. The hook
  // pauses on hidden tabs to avoid burning Gmail API quota in the
  // background. Only refetches messages when the server reports a new
  // landing — keeps the UI from flickering on idle ticks.
  useVisiblePoll(async () => {
    if (!activeId) return;
    const res = await refreshActiveThread(activeId);
    if (!res.ok || !res.updated) return;
    const next = await getEmailThreadMessages({ threadId: activeId });
    setMessages(next.messages as Message[]);
    // Refresh the thread list so the snippet/timestamp on the rail
    // updates as well. Server component re-renders quickly enough that
    // the active selection is preserved.
    router.refresh();
    requestAnimationFrame(() => {
      messagesScrollRef.current?.scrollTo({
        top: messagesScrollRef.current.scrollHeight,
      });
    });
  }, 10_000);

  const activeThread = threads.find((t) => t.id === activeId) ?? null;
  // Reply target: the most recent inbound message's From, falling back
  // to the linked lead's email when the thread is purely outbound.
  const replyToAddr = (() => {
    if (!activeThread) return null;
    const lastInbound = [...messages].reverse().find((m) => m.direction === 'inbound');
    return lastInbound?.fromAddr || activeThread.leadEmail || null;
  })();

  function setScope(next: 'mine' | 'all') {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.set('scope', 'all');
    else params.delete('scope');
    params.delete('thread');
    router.replace(`/conversations?${params.toString()}`);
  }

  function selectThread(id: string) {
    setActiveId(id);
    setComposeMode(false);
    const params = new URLSearchParams(searchParams.toString());
    params.set('thread', id);
    router.replace(`/conversations?${params.toString()}`, { scroll: false });
  }

  function startCompose() {
    setActiveId(null);
    setComposeMode(true);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('thread');
    router.replace(`/conversations?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ─── Left rail ───────────────────────────────────────────── */}
      <div className="flex w-[320px] shrink-0 flex-col border-r border-line bg-canvas">
        {/* Header row: scope toggle + compose icon */}
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex items-center rounded-lg border border-line bg-surface p-0.5 text-[11.5px]">
            <button
              type="button"
              onClick={() => setScope('mine')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                scope === 'mine' ? 'bg-canvas text-txt-1 shadow-sm' : 'text-txt-3 hover:text-txt-2'
              }`}
            >
              Mine
            </button>
            <button
              type="button"
              onClick={() => setScope('all')}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                scope === 'all' ? 'bg-canvas text-txt-1 shadow-sm' : 'text-txt-3 hover:text-txt-2'
              }`}
            >
              All
            </button>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {/* Channel filter — single icon-pair until SMS lands */}
            <span
              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 text-[10.5px] font-medium text-txt-2"
              title="Channels: Email active, SMS pending A2P 10DLC"
            >
              <span className="inline-flex items-center gap-1 text-teal">
                <span className="h-1.5 w-1.5 rounded-full bg-teal" />
                Email
              </span>
              <span className="text-line">·</span>
              <span className="inline-flex items-center gap-1 text-txt-3/70 line-through">
                SMS
              </span>
            </span>
            {canSend && (
              <button
                type="button"
                onClick={startCompose}
                title="New email"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-txt-2 transition-colors hover:border-teal/50 hover:bg-teal/5 hover:text-teal"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Thread list */}
        <ul className="flex-1 overflow-auto">
          {threads.length === 0 && (
            <li className="px-4 py-6 text-[12px] text-txt-3">No conversations yet.</li>
          )}
          {threads.map((t) => {
            const active = t.id === activeId;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectThread(t.id)}
                  className={`relative flex w-full flex-col gap-0.5 border-b border-line px-4 py-2.5 text-left transition-colors ${
                    active ? 'bg-teal/5' : 'hover:bg-surface'
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-teal" />
                  )}
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[13px] font-semibold text-txt-1">
                      {t.leadName || t.leadEmail || 'Unmatched'}
                    </span>
                    <span className="ml-auto shrink-0 text-[10.5px] text-txt-3">
                      {formatWhen(t.lastMessageAt)}
                    </span>
                  </div>
                  <div className="truncate text-[12px] text-txt-2">
                    {t.subject || '(no subject)'}
                  </div>
                  {t.snippet && (
                    <div className="truncate text-[11.5px] text-txt-3">{t.snippet}</div>
                  )}
                  {scope === 'all' && t.memberName && t.memberId !== currentMemberId && (
                    <div className="mt-1 inline-flex items-center gap-1 self-start text-[10px] text-txt-3">
                      <span className="h-1 w-1 rounded-full bg-txt-3/40" />
                      {t.memberName}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* ─── Right pane ──────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-canvas">
        {composeMode && canSend && fromAddr ? (
          <ComposePane
            fromAddr={fromAddr}
            signature={signature}
            onCancel={() => setComposeMode(false)}
            onSent={(threadId) => {
              setComposeMode(false);
              router.refresh();
              // If we have the new thread id, switch to it.
              if (threadId) {
                const params = new URLSearchParams(searchParams.toString());
                params.set('thread', threadId);
                router.replace(`/conversations?${params.toString()}`, { scroll: false });
                setActiveId(threadId);
              }
            }}
          />
        ) : !activeThread ? (
          <EmptyState canSend={canSend} onCompose={canSend ? startCompose : undefined} />
        ) : (
          <ThreadPane
            thread={activeThread}
            messages={messages}
            loading={loading}
            scrollRef={messagesScrollRef}
            canSend={canSend && !!fromAddr && !!replyToAddr}
            fromAddr={fromAddr}
            signature={signature}
            replyToAddr={replyToAddr}
            onSent={async () => {
              const fresh = await reloadActive();
              router.refresh();
              requestAnimationFrame(() => {
                messagesScrollRef.current?.scrollTo({
                  top: messagesScrollRef.current.scrollHeight,
                });
              });
              return fresh;
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────────────
function EmptyState({ canSend, onCompose }: { canSend: boolean; onCompose?: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal/10 text-teal">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8M8 13h5" />
        </svg>
      </div>
      <div>
        <div className="text-[13.5px] font-semibold text-txt-1">
          Pick a conversation
        </div>
        <div className="mt-1 text-[12px] text-txt-3">
          {canSend
            ? 'Or start a new one with the compose button.'
            : 'Connect your email in Settings → Connections to send and reply.'}
        </div>
      </div>
      {canSend && onCompose && (
        <button
          type="button"
          onClick={onCompose}
          className="mt-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 transition-colors hover:border-teal/50 hover:text-teal"
        >
          New email
        </button>
      )}
    </div>
  );
}

// ─── Active thread + inline reply ────────────────────────────────
function ThreadPane({
  thread,
  messages,
  loading,
  scrollRef,
  canSend,
  fromAddr,
  signature,
  replyToAddr,
  onSent,
}: {
  thread: BrandEmailThreadRow;
  messages: Message[];
  loading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  canSend: boolean;
  fromAddr: string | null;
  signature: string | null;
  replyToAddr: string | null;
  onSent: () => Promise<Message[]>;
}) {
  return (
    <>
      {/* Thread header */}
      <div className="flex shrink-0 flex-col gap-1 border-b border-line px-6 py-4">
        <div className="text-[15px] font-semibold leading-tight text-txt-1">
          {thread.subject || '(no subject)'}
        </div>
        <div className="flex items-center gap-2 text-[11.5px] text-txt-3">
          {thread.leadId ? (
            <Link
              href={`/leads?lead=${thread.leadId}`}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-txt-2 transition-colors hover:border-teal/40 hover:text-teal"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-teal" />
              {thread.leadName || thread.leadEmail || 'Open lead'}
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-txt-3">
              <span className="h-1.5 w-1.5 rounded-full bg-txt-3/40" />
              {thread.leadEmail || 'Unmatched'}
            </span>
          )}
          {thread.memberName && (
            <span className="text-txt-3">via {thread.memberName}</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-4">
        {loading && messages.length === 0 ? (
          <p className="text-[12px] text-txt-3">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-[12px] text-txt-3">No messages.</p>
        ) : (
          <ul className="space-y-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </ul>
        )}
      </div>

      {/* Inline reply bar — always present when sendable. */}
      {canSend && replyToAddr && fromAddr && (
        <InlineReplyBar
          threadId={thread.id}
          leadId={thread.leadId}
          toAddr={replyToAddr}
          subject={
            thread.subject
              ? thread.subject.startsWith('Re:')
                ? thread.subject
                : `Re: ${thread.subject}`
              : 'Re:'
          }
          fromAddr={fromAddr}
          signature={signature}
          onSent={onSent}
        />
      )}
    </>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === 'outbound';
  return (
    <li className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[78%] flex-col gap-1 ${isOutbound ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center gap-1.5 text-[10.5px] text-txt-3">
          <span className="font-medium text-txt-2">
            {isOutbound ? 'You' : message.fromAddr || 'Sender'}
          </span>
          <span className="text-line">·</span>
          <span>{formatFull(message.sentAt)}</span>
        </div>
        <div
          className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
            isOutbound
              ? 'bg-teal text-white'
              : 'border border-line bg-surface text-txt-1'
          }`}
        >
          {message.bodyHtml ? (
            <div
              className={`max-h-[360px] overflow-auto whitespace-pre-wrap ${
                isOutbound ? '[&_a]:text-white [&_a]:underline' : ''
              }`}
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: message.bodyHtml }}
            />
          ) : (
            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap font-sans">
              {message.bodyText ?? ''}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── Inline reply bar (always-on, iMessage-style) ───────────────
function InlineReplyBar({
  threadId,
  leadId,
  toAddr,
  subject,
  fromAddr,
  signature,
  onSent,
}: {
  threadId: string;
  leadId: string | null;
  toAddr: string;
  subject: string;
  fromAddr: string;
  signature: string | null;
  onSent: () => Promise<Message[]>;
}) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const taRef = useRef<HTMLTextAreaElement>(null);

  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }

  useEffect(autosize, [body]);

  function send() {
    setError(null);
    const trimmed = body.trim();
    if (!trimmed) return;
    const sigHtml = signature?.trim() ? `<br><br>${signature.trim()}` : '';
    const bodyHtml =
      trimmed
        .split(/\r?\n/)
        .map((line) => escapeHtml(line))
        .join('<br>') + sigHtml;
    const bodyText =
      trimmed +
      (signature?.trim() ? `\n\n${signature.replace(/<[^>]+>/g, '')}` : '');
    start(async () => {
      const res = await sendEmail({
        leadId,
        toAddr,
        subject,
        bodyHtml,
        bodyText,
        threadId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBody('');
      await onSent();
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="shrink-0 border-t border-line bg-surface px-4 py-3">
      {error && (
        <div className="mb-2 rounded-lg border border-hp/40 bg-hp/10 px-3 py-1.5 text-[11.5px] text-hp">
          {error}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-2xl border border-line bg-canvas px-3 py-2 transition-colors focus-within:border-teal/60">
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={`Reply to ${toAddr}…`}
          className="flex-1 resize-none bg-transparent text-[13px] leading-relaxed outline-none placeholder:text-txt-3"
        />
        <button
          type="button"
          disabled={pending || !body.trim()}
          onClick={send}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal text-white transition-opacity hover:bg-teal/90 disabled:opacity-30"
          title="Send (⌘ Enter)"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-txt-3">
        <span>From {fromAddr}</span>
        <span className="text-line">·</span>
        <span>⌘ Enter to send</span>
        {signature?.trim() && (
          <>
            <span className="text-line">·</span>
            <span>Signature appended</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Compose pane (new email) ────────────────────────────────────
function ComposePane({
  fromAddr,
  signature,
  onCancel,
  onSent,
}: {
  fromAddr: string;
  signature: string | null;
  onCancel: () => void;
  onSent: (threadId?: string) => void;
}) {
  const [toInput, setToInput] = useState('');
  const [selectedLead, setSelectedLead] = useState<LeadSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<LeadSuggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (selectedLead) return;
    const q = toInput.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const rows = await searchLeads({ query: q });
      setSuggestions(rows.filter((r) => r.email));
    }, 180);
  }, [toInput, selectedLead]);

  function autosize() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }

  useEffect(autosize, [body]);

  function pickLead(lead: LeadSuggestion) {
    setSelectedLead(lead);
    setToInput(lead.email ?? '');
    setShowSuggest(false);
  }

  function clearLead() {
    setSelectedLead(null);
    setToInput('');
    setSuggestions([]);
  }

  function send() {
    setError(null);
    const trimmed = body.trim();
    if (!subject.trim() || !trimmed) {
      setError('Subject and message are required.');
      return;
    }
    if (!selectedLead && !toInput.trim()) {
      setError('Pick a lead or type a recipient email.');
      return;
    }
    const sigHtml = signature?.trim() ? `<br><br>${signature.trim()}` : '';
    const bodyHtml =
      trimmed
        .split(/\r?\n/)
        .map((line) => escapeHtml(line))
        .join('<br>') + sigHtml;
    const bodyText =
      trimmed +
      (signature?.trim() ? `\n\n${signature.replace(/<[^>]+>/g, '')}` : '');

    start(async () => {
      const res = await sendEmail({
        leadId: selectedLead?.id ?? null,
        toAddr: selectedLead ? null : toInput.trim(),
        subject: subject.trim(),
        bodyHtml,
        bodyText,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSent(res.threadId);
    });
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-line px-6 py-3">
        <div className="text-[13.5px] font-semibold text-txt-1">New email</div>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11.5px] text-txt-3 hover:text-txt-1"
        >
          Discard
        </button>
      </div>

      {/* Header form fields */}
      <div className="shrink-0 border-b border-line px-6 py-3">
        <div className="grid gap-2">
          <div className="relative flex items-center gap-3 border-b border-line/60 pb-2">
            <span className="w-12 shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-txt-3">
              From
            </span>
            <span className="text-[12.5px] text-txt-2">{fromAddr}</span>
          </div>

          <div className="relative flex items-start gap-3 border-b border-line/60 pb-2">
            <span className="mt-1 w-12 shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-txt-3">
              To
            </span>
            <div className="flex-1">
              {selectedLead ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 rounded-md border border-teal/40 bg-teal/5 px-2 py-1 text-[12px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal" />
                    <span className="font-medium text-txt-1">{selectedLead.name}</span>
                    <span className="text-txt-3">{selectedLead.email}</span>
                  </span>
                  <button
                    type="button"
                    onClick={clearLead}
                    className="text-[11px] text-txt-3 hover:text-txt-1"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={toInput}
                    onChange={(e) => {
                      setToInput(e.target.value);
                      setShowSuggest(true);
                    }}
                    onFocus={() => setShowSuggest(true)}
                    onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                    placeholder="Search leads or type an email"
                    className="w-full bg-transparent text-[13px] outline-none placeholder:text-txt-3"
                  />
                  {showSuggest && suggestions.length > 0 && (
                    <ul className="absolute left-12 right-0 z-10 mt-2 max-h-60 overflow-auto rounded-lg border border-line bg-surface shadow-lg">
                      {suggestions.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => pickLead(s)}
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-[12.5px] hover:bg-surface-2"
                          >
                            <span className="font-medium text-txt-1">{s.name}</span>
                            <span className="text-[11px] text-txt-3">{s.email}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="w-12 shrink-0 text-[10.5px] font-medium uppercase tracking-wide text-txt-3">
              Subject
            </span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-txt-3"
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <textarea
          ref={taRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKey}
          placeholder="Write your message…"
          className="min-h-[160px] w-full resize-none bg-transparent text-[13.5px] leading-relaxed outline-none placeholder:text-txt-3"
        />
      </div>

      {/* Footer / send */}
      <div className="shrink-0 border-t border-line bg-surface px-6 py-3">
        {error && (
          <div className="mb-2 rounded-lg border border-hp/40 bg-hp/10 px-3 py-1.5 text-[11.5px] text-hp">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between">
          <div className="text-[10.5px] text-txt-3">
            ⌘ Enter to send
            {signature?.trim() && ' · Signature appended'}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={send}
            className="inline-flex items-center gap-2 rounded-lg bg-teal px-3.5 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-teal/90 disabled:opacity-50"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            {pending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
