'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  getEmailThreadMessages,
  getLeadEmail,
  sendEmailToLead,
} from '@/app/actions/email';

type Thread = {
  id: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: string | null;
};

type Message = {
  id: string;
  direction: 'outbound' | 'inbound';
  fromAddr: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string;
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Lead-detail email section. Lists prior threads, lets the agent open
// any thread to see its messages, and ships a composer for new mail or
// a reply within the active thread.
export function LeadEmailSection({
  leadId,
  leadEmail,
  doNotEmail,
}: {
  leadId: string;
  leadEmail: string | null;
  doNotEmail: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [canSend, setCanSend] = useState(false);
  const [fromAddr, setFromAddr] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  async function refresh() {
    const res = await getLeadEmail({ leadId });
    setThreads(res.threads);
    setActiveThreadId(res.activeThreadId);
    setMessages(res.messages as Message[]);
    setCanSend(res.canSend);
    setFromAddr(res.fromAddr);
    setSignature(res.signature);
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function selectThread(id: string) {
    if (id === activeThreadId) return;
    setActiveThreadId(id);
    const res = await getEmailThreadMessages({ threadId: id });
    setMessages(res.messages as Message[]);
    setComposerOpen(false);
  }

  if (loading) {
    return (
      <p className="text-[12px] text-txt-3">Loading email…</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11.5px] text-txt-3">
          {fromAddr ? (
            <>
              From <span className="font-medium text-txt-2">{fromAddr}</span>
            </>
          ) : canSend ? null : (
            <>
              <a
                href="/settings/connections"
                className="text-teal hover:underline"
              >
                Connect email
              </a>{' '}
              to send from this CRM.
            </>
          )}
        </div>
        {canSend && leadEmail && !doNotEmail && (
          <button
            type="button"
            onClick={() => {
              setComposerOpen((v) => !v);
            }}
            className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-txt-2 hover:bg-surface-2"
          >
            {composerOpen ? 'Cancel' : threads.length > 0 ? 'Reply' : 'New email'}
          </button>
        )}
      </div>

      {!leadEmail && (
        <p className="text-[11.5px] text-txt-3">
          Lead has no email address.
        </p>
      )}
      {leadEmail && doNotEmail && (
        <p className="text-[11.5px] text-hp">
          Lead has opted out of email (Do not email).
        </p>
      )}

      {composerOpen && canSend && leadEmail && !doNotEmail && (
        <Composer
          leadId={leadId}
          to={leadEmail}
          replyToThreadId={activeThreadId}
          replyToSubject={
            activeThreadId
              ? threads.find((t) => t.id === activeThreadId)?.subject ?? null
              : null
          }
          signature={signature}
          onSent={async () => {
            setComposerOpen(false);
            await refresh();
          }}
        />
      )}

      {threads.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-1">
            {threads.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => selectThread(t.id)}
                  className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] ${
                    t.id === activeThreadId
                      ? 'bg-teal/10 text-teal'
                      : 'hover:bg-surface-2 text-txt-2'
                  }`}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="truncate font-medium">
                      {t.subject || '(no subject)'}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] text-txt-3">
                      {t.lastMessageAt ? formatWhen(t.lastMessageAt) : ''}
                    </span>
                  </div>
                  {t.snippet && (
                    <div className="mt-0.5 truncate text-[11px] text-txt-3">
                      {t.snippet}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>

          {messages.length > 0 && (
            <ul className="mt-2 space-y-2 border-t border-line pt-2">
              {messages.map((m) => (
                <li
                  key={m.id}
                  className={`rounded-lg border px-3 py-2 text-[12px] ${
                    m.direction === 'outbound'
                      ? 'border-teal/30 bg-teal/5'
                      : 'border-line bg-canvas'
                  }`}
                >
                  <div className="flex items-baseline gap-2 text-[11px] text-txt-3">
                    <span className="font-medium text-txt-2">
                      {m.direction === 'outbound' ? 'Sent' : 'Received'}
                    </span>
                    <span>·</span>
                    <span className="truncate">{m.fromAddr || ''}</span>
                    <span className="ml-auto shrink-0">{formatWhen(m.sentAt)}</span>
                  </div>
                  <MessageBody html={m.bodyHtml} text={m.bodyText} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {threads.length === 0 && !composerOpen && canSend && leadEmail && !doNotEmail && (
        <p className="text-[11.5px] text-txt-3">No emails yet.</p>
      )}
    </div>
  );
}

function MessageBody({ html, text }: { html: string | null; text: string | null }) {
  if (html) {
    return (
      <div
        className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap text-[12.5px] text-txt-1"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-sans text-[12.5px] text-txt-1">
      {text ?? ''}
    </pre>
  );
}

function Composer({
  leadId,
  to,
  replyToThreadId,
  replyToSubject,
  signature,
  onSent,
}: {
  leadId: string;
  to: string;
  replyToThreadId: string | null;
  replyToSubject: string | null;
  signature: string | null;
  onSent: () => void;
}) {
  const isReply = !!replyToThreadId;
  const initialSubject = isReply
    ? replyToSubject?.startsWith('Re:')
      ? replyToSubject
      : `Re: ${replyToSubject ?? ''}`.trim()
    : '';
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    setError(null);
    const trimmed = body.trim();
    if (!subject.trim() || !trimmed) {
      setError('Subject and body are required.');
      return;
    }
    // Convert plain-text composer input to minimal HTML (preserve line
    // breaks). Phase 2E swaps this for a rich-text editor.
    const sigHtml = signature?.trim() ? `<br><br>${signature.trim()}` : '';
    const bodyHtml = trimmed
      .split(/\r?\n/)
      .map((line) => escapeHtml(line))
      .join('<br>') + sigHtml;
    const bodyText =
      trimmed + (signature?.trim() ? `\n\n${signature.replace(/<[^>]+>/g, '')}` : '');

    start(async () => {
      const res = await sendEmailToLead({
        leadId,
        subject: subject.trim(),
        bodyHtml,
        bodyText,
        threadId: replyToThreadId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSent();
    });
  }

  return (
    <div className="space-y-2 rounded-xl border border-line bg-canvas p-3">
      <div className="text-[11.5px] text-txt-3">
        To <span className="text-txt-2">{to}</span>
      </div>
      <input
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-teal/60"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        placeholder="Type your message…"
        className="w-full resize-y rounded-lg border border-line bg-surface px-2.5 py-2 text-[13px] outline-none focus:border-teal/60"
      />
      {signature?.trim() && (
        <div className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-[11px] text-txt-3">
          Signature will be appended automatically.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-2.5 py-1.5 text-[11.5px] text-hp">
          {error}
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={send}
          className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send'}
        </button>
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
