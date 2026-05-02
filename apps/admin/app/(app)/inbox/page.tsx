// Inbound inbox: triage missed calls + voicemails. Tabs over filter
// modes; each row shows caller, duration, lead link, recording playback,
// and Call Back / Mark Handled actions.

import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import { loadInboundInbox, type InboxFilter } from '@/lib/inbound-inbox';
import { PageHeader } from '@/components/page-header';
import { InboxRowActions } from '@/components/inbox/inbox-row-actions';
import { RecordingButton } from '@/components/calls/recording-button';

const TABS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'Open' },
  { value: 'missed', label: 'Missed' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'handled', label: 'Handled' },
];

function parseFilter(v: string | undefined): InboxFilter {
  if (v === 'missed' || v === 'voicemail' || v === 'handled') return v;
  return 'all';
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const active = await getActiveBrand();
  if (!active) redirect('/');
  const filter = parseFilter(sp.tab);
  const rows = await loadInboundInbox(active.id, filter);

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={`${rows.length} inbound${filter !== 'all' ? ` · ${filter}` : ' open'}`}
      />
      <div className="flex-1 space-y-4 overflow-auto p-6">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1 w-fit">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={t.value === 'all' ? '/inbox' : `/inbox?tab=${t.value}`}
              className={`rounded-md px-3 py-1.5 text-[12.5px] font-medium ${
                filter === t.value
                  ? 'bg-canvas text-txt-1'
                  : 'text-txt-3 hover:text-txt-2'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line-2 bg-surface p-10 text-center text-[13px] text-txt-3">
            {filter === 'handled'
              ? 'No handled inbound calls in this view.'
              : 'No inbound calls waiting.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-surface">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-canvas/50 text-left text-[10.5px] uppercase tracking-wide text-txt-3">
                  <th className="px-4 py-2 font-semibold">When</th>
                  <th className="px-4 py-2 font-semibold">Caller</th>
                  <th className="px-4 py-2 font-semibold">Type</th>
                  <th className="px-4 py-2 font-semibold">Duration</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const leadName = [r.leadFirstName, r.leadLastName]
                    .filter(Boolean)
                    .join(' ')
                    .trim();
                  return (
                    <tr key={r.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2 text-txt-2">
                        {new Date(r.startedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        {r.leadId ? (
                          <Link
                            href={`/leads/${r.leadId}` as Route}
                            className="font-medium hover:text-teal"
                          >
                            {leadName || r.fromNumber}
                          </Link>
                        ) : (
                          <span className="font-mono text-txt-2">{r.fromNumber}</span>
                        )}
                        {leadName && (
                          <div className="font-mono text-[10.5px] text-txt-3">
                            {r.leadPhone ?? r.fromNumber}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                            r.isVoicemail
                              ? 'bg-amber-500/15 text-amber-500'
                              : 'bg-line/40 text-txt-3'
                          }`}
                        >
                          {r.isVoicemail ? 'Voicemail' : 'Missed'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-txt-2">
                        <div className="flex items-center gap-2">
                          {r.hasRecording && (
                            <RecordingButton
                              callId={r.id}
                              durationSec={r.recordingDurationSec}
                              size="xs"
                            />
                          )}
                          <span className="font-mono text-[11px] text-txt-3">
                            {r.durationSec ? `${Math.round(r.durationSec)}s` : '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-txt-3">
                        {r.handledAt ? (
                          <span>
                            Handled
                            {r.handledByName ? ` · ${r.handledByName}` : ''}
                          </span>
                        ) : (
                          <span className="text-amber-500">Open</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <InboxRowActions
                          callId={r.id}
                          leadId={r.leadId}
                          fromNumber={r.fromNumber}
                          handled={!!r.handledAt}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
