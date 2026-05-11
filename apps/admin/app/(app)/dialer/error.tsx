'use client';

// Route-scoped error boundary for the dialer. Without this, any
// client-side throw during dial (SignalWire SDK edge case, stale
// session destroy, a render exception in the in-call widget) trips
// Next.js's bare "Application error" page and forces a hard refresh
// — agents lose their queue position and have to start over.
//
// With this boundary in place, the agent gets a recoverable card and
// `reset()` re-mounts the dialer subtree without a full reload, so
// the SignalWire client is freshly initialized and the queue can be
// resumed from the persisted outcomes (PowerDialer's localStorage
// resume logic).

import { useEffect } from 'react';
import Link from 'next/link';

export default function DialerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dialer] error', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg p-8">
      <div className="rounded-2xl border border-hp/40 bg-hp/10 p-6">
        <h2 className="text-[15px] font-semibold text-hp">
          Dialer hit a snag
        </h2>
        <p className="mt-2 text-[12.5px] text-txt-2">
          Something went wrong while running the dialer. Click Reset to keep
          dialing — your queue position is saved and the call session has
          been cleaned up. No need to refresh the page.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-txt-3">
            Digest: {error.digest}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal/90"
          >
            Reset dialer
          </button>
          <Link
            href="/leads"
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-txt-2 hover:bg-canvas"
          >
            Back to Leads
          </Link>
        </div>
      </div>
    </div>
  );
}
