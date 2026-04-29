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

// Tone is conveyed by a small dot, not by tinting the whole button —
// keeps the grid calm so only the selected option lights up.
const TONE_DOT: Record<Choice['tone'], string> = {
  good: 'bg-teal',
  neutral: 'bg-txt-3/50',
  bad: 'bg-hp',
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
    <div className="space-y-2.5">
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-txt-3">
          How did the call go?
        </div>
        <div className="grid grid-cols-2 gap-1">
          {CHOICES.map((c) => {
            const active = code === c.code;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => setCode(c.code)}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'border-teal bg-teal text-white'
                    : 'border-line bg-canvas text-txt-2 hover:bg-surface-2'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    active ? 'bg-white/80' : TONE_DOT[c.tone]
                  }`}
                />
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {code === 'callback' && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-txt-3">
            Callback when?
          </div>
          <input
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
        </div>
      )}

      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-txt-3">
          Note <span className="text-txt-3 normal-case">(optional)</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What did they say?"
          className="w-full resize-none rounded-md border border-line bg-canvas px-2 py-1 text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        />
      </div>

      {error && (
        <div className="rounded-md border border-hp/40 bg-hp/10 px-2 py-1 text-[10.5px] text-hp">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !code}
          className="flex-1 rounded-lg bg-teal py-2 text-[12px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-line px-2.5 py-2 text-[12px] text-txt-2 hover:bg-canvas"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
