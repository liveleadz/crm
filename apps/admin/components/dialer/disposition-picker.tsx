'use client';

// Disposition picker shown after every call. Must be set before the
// dialer returns to idle, so nothing slips through without an outcome.

import { useState, useTransition } from 'react';
import { setDisposition, type DispositionCode } from '@/app/actions/dialer';

type Choice = {
  code: DispositionCode;
  label: string;
  tone: 'good' | 'neutral' | 'bad';
};

// Order = mental flow (positive → neutral → reach failure → negative).
const CHOICES: Choice[] = [
  { code: 'connected', label: 'Connected', tone: 'good' },
  { code: 'sale', label: 'Sale', tone: 'good' },
  { code: 'callback', label: 'Callback', tone: 'good' },
  { code: 'voicemail', label: 'Voicemail', tone: 'neutral' },
  { code: 'no_answer', label: 'No answer', tone: 'neutral' },
  { code: 'busy', label: 'Busy', tone: 'neutral' },
  { code: 'wrong_number', label: 'Wrong number', tone: 'bad' },
  { code: 'not_interested', label: 'Not interested', tone: 'bad' },
  { code: 'do_not_call', label: 'DNC', tone: 'bad' },
  { code: 'failed', label: 'Failed', tone: 'bad' },
];

const TONE_CLASS: Record<Choice['tone'], string> = {
  good: 'border-teal/40 bg-teal/10 text-teal hover:bg-teal/20',
  neutral: 'border-line bg-canvas text-txt-2 hover:bg-surface-2',
  bad: 'border-hp/40 bg-hp/10 text-hp hover:bg-hp/20',
};

type Props = {
  callId: string;
  // Called after a successful save so the parent can clean up (return to
  // idle, close modal, refresh data, etc.).
  onSaved: () => void;
  // Optional cancel — only used when this picker is shown retroactively
  // for a past call (in /calls list). Hidden in the live dialer flow.
  onCancel?: () => void;
};

export function DispositionPicker({ callId, onSaved, onCancel }: Props) {
  const [code, setCode] = useState<DispositionCode | null>(null);
  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!code) {
      setError('Pick a disposition first.');
      return;
    }
    if (code === 'callback' && !callbackAt) {
      setError('Set a callback time.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await setDisposition({
        callId,
        disposition: code,
        note: note || null,
        callbackAt: callbackAt ? new Date(callbackAt).toISOString() : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          How did the call go?
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {CHOICES.map((c) => {
            const active = code === c.code;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => setCode(c.code)}
                className={`rounded-lg border px-2 py-1.5 text-[11.5px] font-medium transition-colors ${
                  active
                    ? 'border-teal bg-teal text-white shadow-sm'
                    : TONE_CLASS[c.tone]
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {code === 'callback' && (
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
            Callback when?
          </div>
          <input
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
            className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
        </div>
      )}

      <div>
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
          Note <span className="text-txt-3 normal-case">(optional)</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What did they say?"
          className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-2.5 py-1.5 text-[11px] text-hp">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !code}
          className="flex-1 rounded-xl bg-teal py-2.5 text-[12.5px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save disposition'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-xl border border-line px-3 py-2.5 text-[12.5px] text-txt-2 hover:bg-canvas"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
