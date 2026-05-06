'use client';

// Per-row action buttons for the Inbox view (rendered inside /calls?view=inbox):
// Call Back (links to dialer in single-call mode), Mark Handled / Reopen toggle.
// Server actions revalidate /calls + /dashboard so the badge counts update.

import Link from 'next/link';
import type { Route } from 'next';
import { useTransition } from 'react';
import { markCallHandled, markCallUnhandled } from '@/app/actions/inbox';

export function InboxRowActions({
  callId,
  leadId,
  fromNumber,
  handled,
}: {
  callId: string;
  leadId: string | null;
  fromNumber: string;
  handled: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function toggle() {
    startTransition(async () => {
      if (handled) await markCallUnhandled(callId);
      else await markCallHandled(callId);
    });
  }

  const callBackHref = leadId
    ? `/dialer?leadId=${leadId}&to=${encodeURIComponent(fromNumber)}`
    : `/dialer?to=${encodeURIComponent(fromNumber)}`;

  return (
    <div className="inline-flex items-center gap-1.5">
      <Link
        href={callBackHref as Route}
        className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] font-medium text-txt-2 hover:border-teal/40 hover:text-teal"
      >
        Call back
      </Link>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="rounded-md border border-line bg-canvas px-2.5 py-1 text-[11.5px] text-txt-2 hover:border-line-2 disabled:opacity-50"
      >
        {handled ? 'Reopen' : 'Mark handled'}
      </button>
    </div>
  );
}
