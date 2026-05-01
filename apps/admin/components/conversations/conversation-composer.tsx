'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { sendEmail } from '@/app/actions/email';
import { searchLeads } from '@/app/actions/leads';

type LeadSuggestion = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
};

type Mode =
  | { kind: 'compose' }
  | { kind: 'reply'; threadId: string; subject: string; toAddr: string; leadId: string | null };

// Reusable composer for the Conversations view. Handles both new mail
// (with lead autocomplete or free-form recipient) and replies within an
// existing thread. Auto-appends the caller's signature at send time.
export function ConversationComposer({
  mode,
  fromAddr,
  signature,
  onSent,
  onCancel,
}: {
  mode: Mode;
  fromAddr: string;
  signature: string | null;
  onSent: () => void;
  onCancel: () => void;
}) {
  const isReply = mode.kind === 'reply';
  const [toInput, setToInput] = useState(isReply ? mode.toAddr : '');
  const [selectedLead, setSelectedLead] = useState<LeadSuggestion | null>(null);
  const [suggestions, setSuggestions] = useState<LeadSuggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [subject, setSubject] = useState(() => {
    if (!isReply) return '';
    return mode.subject.startsWith('Re:') ? mode.subject : `Re: ${mode.subject}`.trim();
  });
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lead autocomplete on the To field. Skipped in reply mode where the
  // recipient is fixed.
  useEffect(() => {
    if (isReply) return;
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
  }, [toInput, isReply, selectedLead]);

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
    const trimmedBody = body.trim();
    if (!subject.trim() || !trimmedBody) {
      setError('Subject and body are required.');
      return;
    }
    if (!isReply && !selectedLead && !toInput.trim()) {
      setError('Recipient is required.');
      return;
    }
    const sigHtml = signature?.trim() ? `<br><br>${signature.trim()}` : '';
    const bodyHtml =
      trimmedBody
        .split(/\r?\n/)
        .map((line) => escapeHtml(line))
        .join('<br>') + sigHtml;
    const bodyText =
      trimmedBody +
      (signature?.trim() ? `\n\n${signature.replace(/<[^>]+>/g, '')}` : '');

    start(async () => {
      const res = await sendEmail({
        leadId: isReply ? mode.leadId : selectedLead?.id ?? null,
        toAddr: isReply ? mode.toAddr : selectedLead ? null : toInput.trim(),
        subject: subject.trim(),
        bodyHtml,
        bodyText,
        threadId: isReply ? mode.threadId : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSent();
    });
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-canvas">
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface px-6 py-3">
        <div className="text-[13px] font-semibold text-txt-1">
          {isReply ? 'Reply' : 'New email'}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12px] text-txt-3 hover:text-txt-1"
        >
          Close
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-auto p-6">
        <div className="text-[11.5px] text-txt-3">
          From <span className="text-txt-2">{fromAddr}</span>
        </div>

        {/* To field */}
        <div className="relative">
          <label className="text-[11px] font-medium uppercase tracking-wide text-txt-3">
            To
          </label>
          {isReply ? (
            <div className="mt-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-txt-2">
              {mode.toAddr}
            </div>
          ) : selectedLead ? (
            <div className="mt-1 flex items-center justify-between rounded-lg border border-teal/40 bg-teal/5 px-3 py-2 text-[13px]">
              <div>
                <span className="font-medium text-txt-1">{selectedLead.name}</span>
                <span className="ml-2 text-txt-3">{selectedLead.email}</span>
              </div>
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
                placeholder="Search leads or type an email address"
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-teal/60"
              />
              {showSuggest && suggestions.length > 0 && (
                <ul className="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-auto rounded-lg border border-line bg-surface shadow-lg">
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

        {/* Subject */}
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-txt-3">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-teal/60"
          />
        </div>

        {/* Body */}
        <div className="flex-1">
          <label className="text-[11px] font-medium uppercase tracking-wide text-txt-3">
            Message
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={isReply ? 8 : 12}
            placeholder="Type your message…"
            className="mt-1 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-teal/60"
          />
        </div>

        {signature?.trim() && (
          <div className="rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-txt-3">
            Signature will be appended automatically.
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
            {error}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface px-6 py-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-surface-2"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={send}
          className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {pending ? 'Sending…' : isReply ? 'Send reply' : 'Send'}
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
