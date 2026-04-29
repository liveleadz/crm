'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createLead } from '@/app/actions/leads';
import type { LeadStage } from '@/lib/leads';

export function NewLeadButton({ stages }: { stages: LeadStage[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90"
      >
        + New lead
      </button>
      {open && <NewLeadDialog stages={stages} onClose={() => setOpen(false)} />}
    </>
  );
}

function NewLeadDialog({
  stages,
  onClose,
}: {
  stages: LeadStage[];
  onClose: () => void;
}) {
  const router = useRouter();
  const sortedStages = [...stages].sort((a, b) => a.position - b.position);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [zip, setZip] = useState('');
  const [stageId, setStageId] = useState(sortedStages[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit() {
    setError(null);
    setSaving(true);
    startTransition(async () => {
      const res = await createLead({
        firstName,
        lastName,
        phone,
        email,
        city,
        state: stateCode,
        zip,
        stageId: stageId || null,
        notes,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-label="New lead"
        className="fixed left-1/2 top-1/2 z-50 w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-[13.5px] font-semibold">New lead</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-7 w-7 place-items-center rounded-lg text-txt-3 hover:bg-canvas"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="space-y-3 p-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name">
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Last name">
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
              className={inputCls}
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="lead@example.com"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-[1fr_80px_100px] gap-3">
            <Field label="City">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="State">
              <input
                type="text"
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value.toUpperCase().slice(0, 2))}
                className={inputCls}
                maxLength={2}
              />
            </Field>
            <Field label="Zip">
              <input
                type="text"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Initial stage">
            <select
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
              className={inputCls}
            >
              <option value="">No stage</option>
              {sortedStages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </Field>
          {error && (
            <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] text-hp">
              {error}
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create lead'}
          </button>
        </footer>
      </div>
    </>
  );
}

const inputCls =
  'w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
        {label}
      </div>
      {children}
    </label>
  );
}
