// Dashboard card: last 5 unhandled inbound calls with quick links to
// Call Back. Shows nothing when the inbox is clean.

import Link from 'next/link';
import { loadInboundInbox } from '@/lib/inbound-inbox';

export async function InboundCard({ brandId }: { brandId: string }) {
  const rows = (await loadInboundInbox(brandId, 'all', 5)).slice(0, 5);

  return (
    <div className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h3 className="text-[13.5px] font-semibold text-txt-1">Inbound</h3>
          <p className="text-[11.5px] text-txt-3">Missed + voicemails awaiting triage</p>
        </div>
        <Link href="/inbox" className="text-[11.5px] text-teal hover:underline">
          View all →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-6 text-center text-[12px] text-txt-3">All clear.</div>
      ) : (
        <ul>
          {rows.map((r) => {
            const name = [r.leadFirstName, r.leadLastName].filter(Boolean).join(' ').trim();
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        r.isVoicemail ? 'bg-amber-500' : 'bg-hp'
                      }`}
                    />
                    <span className="truncate text-[12.5px] font-medium text-txt-1">
                      {name || r.fromNumber}
                    </span>
                    {r.isVoicemail && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wide text-amber-500">
                        VM
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-txt-3">
                    {new Date(r.startedAt).toLocaleString()}
                  </div>
                </div>
                <Link
                  href={
                    r.leadId
                      ? `/dialer?leadId=${r.leadId}&to=${encodeURIComponent(r.fromNumber)}`
                      : `/dialer?to=${encodeURIComponent(r.fromNumber)}`
                  }
                  className="shrink-0 rounded-md border border-line bg-canvas px-2.5 py-1 text-[11px] font-medium text-txt-2 hover:border-teal/40 hover:text-teal"
                >
                  Call back
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
