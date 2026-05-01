'use client';

import { useTransition } from 'react';
import { disconnectProvider } from '@/app/actions/integrations';

const LABELS = {
  google: 'Google',
} as const;

type Provider = keyof typeof LABELS;

export function ConnectionCard({
  provider,
  connected,
  accountEmail,
  scopes,
}: {
  provider: Provider;
  connected: boolean;
  accountEmail: string | null;
  scopes: string[];
}) {
  const [pending, start] = useTransition();
  const startUrl = `/api/oauth/${provider}/start?intent=calendar&return_to=${encodeURIComponent('/settings/connections')}`;

  function disconnect() {
    if (!window.confirm(`Disconnect ${LABELS[provider]}? Calendars owned by you will stop syncing.`)) {
      return;
    }
    start(async () => {
      await disconnectProvider({ provider });
    });
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <span
          className={`grid h-9 w-9 place-items-center rounded-lg ${
            connected ? 'bg-teal/10 text-teal' : 'bg-canvas text-txt-3'
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{LABELS[provider]}</div>
          <div className="truncate text-[11.5px] text-txt-3">
            {connected
              ? accountEmail || 'Connected'
              : `Connect your ${LABELS[provider]} account to sync calendars`}
          </div>
          {connected && scopes.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {scopes.map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-teal/10 px-2 py-0.5 text-[10.5px] font-medium text-teal"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {connected ? (
            <>
              <a
                href={startUrl}
                className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] font-medium hover:bg-surface-2"
              >
                Reconnect
              </a>
              <button
                type="button"
                disabled={pending}
                onClick={disconnect}
                className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-hp hover:bg-hp/10 disabled:opacity-50"
              >
                {pending ? 'Disconnecting…' : 'Disconnect'}
              </button>
            </>
          ) : (
            <a
              href={startUrl}
              className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90"
            >
              Connect
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
