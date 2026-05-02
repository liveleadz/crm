import Link from 'next/link';
import type { AgentCampaignSummary } from '@/lib/campaigns';

// Compact card for the agent dashboard. One row per assigned campaign,
// today's per-rep stats inline, and a one-click jump into the dialer.
export function MyCampaigns({ campaigns }: { campaigns: AgentCampaignSummary[] }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-txt-3">
          My campaigns
        </div>
        <Link
          href="/campaigns"
          className="text-[11px] text-teal hover:underline"
        >
          View all
        </Link>
      </div>
      {campaigns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-canvas p-4 text-center text-[12px] text-txt-3">
          No campaigns assigned yet.
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      c.status === 'active'
                        ? 'bg-teal'
                        : c.status === 'paused'
                          ? 'bg-amber-400'
                          : 'bg-txt-3'
                    }`}
                  />
                  <Link
                    href={{ pathname: `/campaigns/${c.id}` }}
                    className="truncate text-[13px] font-medium text-txt-1 hover:text-teal"
                  >
                    {c.name}
                  </Link>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[11px] text-txt-3">
                  <span>
                    <span className="font-medium text-txt-2">{c.callsToday}</span> calls
                  </span>
                  <span>
                    <span className="font-medium text-txt-2">{c.connectsToday}</span> connects
                  </span>
                  <span>
                    <span className="font-medium text-txt-2">{c.apptsToday}</span> appts
                  </span>
                </div>
              </div>
              {c.status === 'active' ? (
                <Link
                  href={{ pathname: '/dialer', query: { campaign: c.id } }}
                  className="rounded-lg bg-teal px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-teal/90"
                >
                  Start dialing
                </Link>
              ) : (
                <span className="rounded-lg border border-line px-3 py-1.5 text-[11.5px] text-txt-3">
                  {c.status === 'paused' ? 'Paused' : 'Archived'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
