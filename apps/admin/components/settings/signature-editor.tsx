'use client';

import { useState, useTransition } from 'react';
import { updateMyEmailSignature } from '@/app/actions/email';

// Per-member email signature. Plain HTML; auto-appended by the lead-detail
// composer. Phase 2 keeps it simple: a textarea. A WYSIWYG editor can land
// alongside the rich-text composer in a follow-up.
export function SignatureEditor({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState<'idle' | 'saved' | 'error'>('idle');
  const [pending, start] = useTransition();

  function save() {
    setSaved('idle');
    start(async () => {
      const res = await updateMyEmailSignature({ signature: value });
      setSaved(res.ok ? 'saved' : 'error');
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-txt-3">
          Email signature
        </h4>
        <span className="text-[10.5px] text-txt-3">
          Appended to every outgoing email
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={4}
        placeholder="— Your name, title, contact"
        className="w-full resize-y rounded-lg border border-line bg-canvas px-3 py-2 text-[12.5px] outline-none focus:border-teal/60"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {saved === 'saved' && (
          <span className="text-[11px] text-teal">Saved</span>
        )}
        {saved === 'error' && (
          <span className="text-[11px] text-hp">Failed to save</span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
