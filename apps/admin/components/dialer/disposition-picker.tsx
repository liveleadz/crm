'use client';

// Disposition picker shown after every call. Must be set before the
// dialer returns to idle, so nothing slips through without an outcome.
// Choices come from the brand's dispositions table, loaded server-side
// and passed in — managers configure them on the settings page.
//
// When a campaignId is supplied (campaign-mode dialer), the picker also
// resolves the disposition_followups template for that scope and shows
// editable email/SMS/task sections — pre-checked, pre-filled — so reps
// fire follow-ups in one click without building a workflow.

import { useEffect, useState, useTransition } from 'react';
import {
  getFollowupForDisposition,
  sendDispositionFollowups,
  setDisposition,
} from '@/app/actions/dialer';
import type { DispositionFollowup } from '@/lib/disposition-followups';

export type DispositionTone = 'good' | 'neutral' | 'bad';
export type DispositionChoice = {
  id: string;
  code: string;
  label: string;
  tone: DispositionTone;
};

// Tone is conveyed by a small dot, not by tinting the whole button —
// keeps the grid calm so only the selected option lights up.
const TONE_DOT: Record<DispositionTone, string> = {
  good: 'bg-teal',
  neutral: 'bg-txt-3/50',
  bad: 'bg-hp',
};

type Props = {
  callId: string;
  choices: DispositionChoice[];
  // Campaign attribution for follow-up resolution + calls.campaign_id
  // backfill. Null means ad-hoc dial — only brand-default templates apply.
  campaignId?: string | null;
  // Called after a successful save so the parent can clean up (return to
  // idle, close modal, refresh data, etc.). Receives the saved code so
  // the caller can display the outcome without a re-fetch.
  onSaved: (code: string) => void;
  // Optional cancel — only used when this picker is shown retroactively
  // for a past call (in /calls list). Hidden in the live dialer flow.
  onCancel?: () => void;
};

// Local edit state for each follow-up channel. Pre-filled from the
// resolved template; the agent can toggle off or tweak the body before
// hitting Save.
type FollowupEdit = {
  email: { send: boolean; subject: string; body: string; available: boolean };
  sms: { send: boolean; body: string; available: boolean };
  task: { create: boolean; title: string; dueMinutes: number | null; available: boolean };
};

function toEdit(tpl: DispositionFollowup | null): FollowupEdit {
  return {
    email: {
      send: !!tpl?.sendEmail,
      subject: tpl?.emailSubject ?? '',
      body: tpl?.emailBody ?? '',
      available: !!tpl?.sendEmail,
    },
    sms: {
      send: !!tpl?.sendSms,
      body: tpl?.smsBody ?? '',
      available: !!tpl?.sendSms,
    },
    task: {
      create: !!tpl?.createTask,
      title: tpl?.taskTitle ?? '',
      dueMinutes: tpl?.taskDueMinutes ?? null,
      available: !!tpl?.createTask,
    },
  };
}

export function DispositionPicker({
  callId,
  choices,
  campaignId = null,
  onSaved,
  onCancel,
}: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [dispositionId, setDispositionId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [callbackAt, setCallbackAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [followup, setFollowup] = useState<FollowupEdit | null>(null);
  const [followupLoading, setFollowupLoading] = useState(false);

  // Whenever the agent picks a disposition, load the resolved follow-up
  // (campaign override → brand default → null) and seed the editable
  // form. Changing disposition replaces the current draft — the rep is
  // explicitly choosing a new outcome.
  useEffect(() => {
    if (!dispositionId) {
      setFollowup(null);
      return;
    }
    let cancelled = false;
    setFollowupLoading(true);
    getFollowupForDisposition({ campaignId, dispositionId })
      .then((tpl) => {
        if (cancelled) return;
        const edit = toEdit(tpl);
        // Only render the section if at least one channel is enabled.
        const anyChannel = edit.email.available || edit.sms.available || edit.task.available;
        setFollowup(anyChannel ? edit : null);
      })
      .catch(() => {
        if (!cancelled) setFollowup(null);
      })
      .finally(() => {
        if (!cancelled) setFollowupLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dispositionId, campaignId]);

  function pick(c: DispositionChoice) {
    setCode(c.code);
    setDispositionId(c.id);
  }

  function submit() {
    if (!code || !dispositionId) {
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
        campaignId,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Fire follow-ups (best-effort — we don't want a template error to
      // roll back the disposition save).
      if (followup) {
        await sendDispositionFollowups({
          callId,
          campaignId,
          dispositionId,
          overrides: {
            email: followup.email.available
              ? {
                  send: followup.email.send,
                  subject: followup.email.subject,
                  body: followup.email.body,
                }
              : { send: false },
            sms: followup.sms.available
              ? { send: followup.sms.send, body: followup.sms.body }
              : { send: false },
            task: followup.task.available
              ? {
                  create: followup.task.create,
                  title: followup.task.title,
                  dueMinutes: followup.task.dueMinutes ?? undefined,
                }
              : { create: false },
          },
        }).catch(() => undefined);
      }
      onSaved(code);
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2.5 text-[14.5px] font-semibold uppercase tracking-wide text-txt-3">
          How did the call go?
        </div>
        <div className="grid grid-cols-2 gap-2">
          {choices.length === 0 && (
            <div className="col-span-2 rounded-md border border-dashed border-line bg-canvas px-3 py-3 text-[15.5px] text-txt-3">
              No dispositions configured. Add some in Settings.
            </div>
          )}
          {choices.map((c) => {
            const active = code === c.code;
            return (
              <button
                key={c.code}
                type="button"
                onClick={() => pick(c)}
                className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-[15.5px] font-medium transition-colors ${
                  active
                    ? 'border-teal bg-teal text-white'
                    : 'border-line bg-canvas text-txt-2 hover:bg-surface-2'
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
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
          <div className="mb-2 text-[14.5px] font-semibold uppercase tracking-wide text-txt-3">
            Callback when?
          </div>
          <input
            type="datetime-local"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
            className="w-full rounded-md border border-line bg-canvas px-3 py-2 text-[17px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
        </div>
      )}

      <div>
        <div className="mb-2 text-[14.5px] font-semibold uppercase tracking-wide text-txt-3">
          Note <span className="text-txt-3 normal-case">(optional)</span>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What did they say?"
          className="w-full resize-none rounded-md border border-line bg-canvas px-3 py-2 text-[17px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        />
      </div>

      {followupLoading && (
        <div className="rounded-md border border-line bg-canvas px-3 py-2 text-[13px] text-txt-3">
          Loading follow-up…
        </div>
      )}

      {followup && !followupLoading && (
        <FollowupSection edit={followup} onChange={setFollowup} />
      )}

      {error && (
        <div className="rounded-md border border-hp/40 bg-hp/10 px-3 py-2 text-[15px] text-hp">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !code}
          className="flex-1 rounded-lg bg-teal py-3 text-[17.5px] font-semibold text-white hover:bg-teal/90 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-lg border border-line px-3.5 py-3 text-[17.5px] text-txt-2 hover:bg-canvas"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// Editable preview of the resolved follow-up. Each available channel
// renders as a labelled toggle + body field. Variables like
// {{lead.first_name}} are server-rendered at enqueue time, so reps see
// the raw template here — keep the placeholder hint visible.
function FollowupSection({
  edit,
  onChange,
}: {
  edit: FollowupEdit;
  onChange: (next: FollowupEdit) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-2/30 p-3">
      <div className="text-[14.5px] font-semibold uppercase tracking-wide text-txt-3">
        Follow-up
      </div>

      {edit.email.available && (
        <div className="space-y-1.5 rounded-md border border-line bg-canvas p-2.5">
          <label className="flex items-center gap-2 text-[13.5px] font-medium text-txt-1">
            <input
              type="checkbox"
              checked={edit.email.send}
              onChange={(e) =>
                onChange({ ...edit, email: { ...edit.email, send: e.target.checked } })
              }
              className="h-3.5 w-3.5 accent-teal"
            />
            Send email
          </label>
          {edit.email.send && (
            <>
              <input
                type="text"
                value={edit.email.subject}
                onChange={(e) =>
                  onChange({ ...edit, email: { ...edit.email, subject: e.target.value } })
                }
                placeholder="Subject"
                className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[13.5px] outline-none focus:border-teal/60"
              />
              <textarea
                value={edit.email.body}
                onChange={(e) =>
                  onChange({ ...edit, email: { ...edit.email, body: e.target.value } })
                }
                rows={3}
                placeholder="Body — supports {{lead.first_name}}"
                className="w-full resize-none rounded-md border border-line bg-canvas px-2 py-1.5 text-[13.5px] outline-none focus:border-teal/60"
              />
            </>
          )}
        </div>
      )}

      {edit.sms.available && (
        <div className="space-y-1.5 rounded-md border border-line bg-canvas p-2.5">
          <label className="flex items-center gap-2 text-[13.5px] font-medium text-txt-1">
            <input
              type="checkbox"
              checked={edit.sms.send}
              onChange={(e) =>
                onChange({ ...edit, sms: { ...edit.sms, send: e.target.checked } })
              }
              className="h-3.5 w-3.5 accent-teal"
            />
            Send SMS
          </label>
          {edit.sms.send && (
            <textarea
              value={edit.sms.body}
              onChange={(e) =>
                onChange({ ...edit, sms: { ...edit.sms, body: e.target.value } })
              }
              rows={2}
              placeholder="SMS body"
              className="w-full resize-none rounded-md border border-line bg-canvas px-2 py-1.5 text-[13.5px] outline-none focus:border-teal/60"
            />
          )}
        </div>
      )}

      {edit.task.available && (
        <div className="space-y-1.5 rounded-md border border-line bg-canvas p-2.5">
          <label className="flex items-center gap-2 text-[13.5px] font-medium text-txt-1">
            <input
              type="checkbox"
              checked={edit.task.create}
              onChange={(e) =>
                onChange({ ...edit, task: { ...edit.task, create: e.target.checked } })
              }
              className="h-3.5 w-3.5 accent-teal"
            />
            Create task
          </label>
          {edit.task.create && (
            <input
              type="text"
              value={edit.task.title}
              onChange={(e) =>
                onChange({ ...edit, task: { ...edit.task, title: e.target.value } })
              }
              placeholder="Task title"
              className="w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[13.5px] outline-none focus:border-teal/60"
            />
          )}
        </div>
      )}
    </div>
  );
}
