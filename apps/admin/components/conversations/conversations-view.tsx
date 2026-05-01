'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getEmailThreadMessages } from '@/app/actions/email';
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

function formatWhen(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Channel-aware unified conversations view. The channel pill row at the
// top is forward-looking — SMS lights up when A2P 10DLC ships. Until
// then it renders disabled. Email threads come from email_threads.
export function ConversationsView({
  threads,
  scope,
  initialThreadId,
  currentMemberId,
}: {
  threads: BrandEmailThreadRow[];
  scope: 'mine' | 'all';
  initialThreadId: string | null;
  currentMemberId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(initialThreadId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    getEmailThreadMessages({ threadId: activeId }).then((res) => {
      setMessages(res.messages as Message[]);
      setLoading(false);
    });
  }, [activeId]);

  const activeThread = threads.find((t) => t.id === activeId) ?? null;

  function setScope(next: 'mine' | 'all') {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'all') params.set('scope', 'all');
    else params.delete('scope');
    params.delete('thread');
    router.replace(`/conversations?${params.toString()}`);
  }

  function selectThread(id: string) {
    setActiveId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('thread', id);
    router.replace(`/conversations?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left pane — thread list */}
      <div className="flex w-[340px] shrink-0 flex-col border-r border-line bg-canvas">
        {/* Channel filter — today only Email is wired. */}
        <div className="flex shrink-0 gap-1 border-b border-line p-3">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-teal/15 px-3 py-1.5 text-[11.5px] font-medium text-teal">
            <span className="h-1.5 w-1.5 rounded-full bg-teal" /> Email
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-[11.5px] font-medium text-txt-3"
            title="SMS arrives once A2P 10DLC registration is approved"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-txt-3/40" /> SMS
            <span className="ml-1 rounded-full bg-surface-2 px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide">
              soon
            </span>
          </span>
        </div>
        {/* Mine / All scope */}
        <div className="flex shrink-0 gap-1 border-b border-line p-3">
          <button
            type="button"
            onClick={() => setScope('mine')}
            className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
              scope === 'mine'
                ? 'bg-teal/15 text-teal'
                : 'bg-surface text-txt-2 hover:bg-surface-2'
            }`}
          >
            Mine
          </button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${
              scope === 'all'
                ? 'bg-teal/15 text-teal'
                : 'bg-surface text-txt-2 hover:bg-surface-2'
            }`}
          >
            All
          </button>
        </div>
        <ul className="flex-1 overflow-auto">
          {threads.length === 0 && (
            <li className="px-4 py-6 text-[12px] text-txt-3">
              No conversations yet.
            </li>
          )}
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => selectThread(t.id)}
                className={`block w-full border-b border-line px-4 py-3 text-left ${
                  t.id === activeId ? 'bg-teal/5' : 'hover:bg-surface'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[12.5px] font-medium text-txt-1">
                    {t.leadName || t.leadEmail || '(unknown lead)'}
                  </span>
                  <span className="ml-auto shrink-0 text-[10.5px] text-txt-3">
                    {formatWhen(t.lastMessageAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="rounded-full bg-teal/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-teal">
                    Email
                  </span>
                  <span className="truncate text-[11.5px] text-txt-2">
                    {t.subject || '(no subject)'}
                  </span>
                </div>
                {t.snippet && (
                  <div className="mt-0.5 truncate text-[11px] text-txt-3">
                    {t.snippet}
                  </div>
                )}
                {scope === 'all' && t.memberName && t.memberId !== currentMemberId && (
                  <div className="mt-1 inline-block rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-txt-3">
                    {t.memberName}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Right pane — messages */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {!activeThread ? (
          <div className="flex flex-1 items-center justify-center text-[12.5px] text-txt-3">
            Select a conversation to view messages.
          </div>
        ) : (
          <>
            <div className="shrink-0 border-b border-line bg-surface px-6 py-4">
              <div className="text-[14px] font-semibold text-txt-1">
                {activeThread.subject || '(no subject)'}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11.5px] text-txt-3">
                {activeThread.leadId ? (
                  <Link
                    href={`/leads?lead=${activeThread.leadId}`}
                    className="text-teal hover:underline"
                  >
                    {activeThread.leadName || activeThread.leadEmail || 'Open lead'}
                  </Link>
                ) : (
                  <span>{activeThread.leadEmail || 'Unmatched'}</span>
                )}
                <span>·</span>
                <span>{activeThread.memberName ?? ''}</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-6">
              {loading ? (
                <p className="text-[12px] text-txt-3">Loading messages…</p>
              ) : messages.length === 0 ? (
                <p className="text-[12px] text-txt-3">No messages.</p>
              ) : (
                <ul className="space-y-3">
                  {messages.map((m) => (
                    <li
                      key={m.id}
                      className={`rounded-xl border px-4 py-3 ${
                        m.direction === 'outbound'
                          ? 'border-teal/30 bg-teal/5'
                          : 'border-line bg-surface'
                      }`}
                    >
                      <div className="flex items-baseline gap-2 text-[11.5px] text-txt-3">
                        <span className="rounded-full bg-teal/10 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-teal">
                          Email
                        </span>
                        <span className="font-medium text-txt-2">
                          {m.direction === 'outbound' ? 'Sent' : 'Received'}
                        </span>
                        <span>·</span>
                        <span className="truncate">{m.fromAddr || ''}</span>
                        <span className="ml-auto shrink-0">{formatWhen(m.sentAt)}</span>
                      </div>
                      {m.bodyHtml ? (
                        <div
                          className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap text-[13px] text-txt-1"
                          // eslint-disable-next-line react/no-danger
                          dangerouslySetInnerHTML={{ __html: m.bodyHtml }}
                        />
                      ) : (
                        <pre className="mt-2 max-h-[480px] overflow-auto whitespace-pre-wrap font-sans text-[13px] text-txt-1">
                          {m.bodyText ?? ''}
                        </pre>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
