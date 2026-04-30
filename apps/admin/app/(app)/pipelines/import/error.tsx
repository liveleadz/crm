'use client';

// Page-scoped error boundary so any server-side throw during the import
// flow (loadKanban / loadCustomFields / revalidatePath aftermath) shows
// a recoverable card instead of the bare Next.js "Application error"
// page. Shows the digest so a user can paste it into a support ticket.

import { useEffect } from 'react';
import Link from 'next/link';

export default function ImportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[pipelines/import] error', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg p-8">
      <div className="rounded-2xl border border-hp/40 bg-hp/10 p-6">
        <h2 className="text-[15px] font-semibold text-hp">Import couldn’t finish loading</h2>
        <p className="mt-2 text-[12.5px] text-txt-2">
          Something went wrong rendering the import page. Your data is safe — anything that
          got inserted before the error is already in Leads.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-[11px] text-txt-3">Digest: {error.digest}</p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal/90"
          >
            Retry
          </button>
          <Link
            href="/leads"
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-txt-2 hover:bg-canvas"
          >
            Back to Leads
          </Link>
          <Link
            href="/pipelines"
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-txt-2 hover:bg-canvas"
          >
            Pipelines
          </Link>
        </div>
      </div>
    </div>
  );
}
