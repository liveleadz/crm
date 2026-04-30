import { PageHeader } from '@/components/page-header';
import { WebRTCDialPad } from '@/components/dialer/webrtc-dial-pad';
import { PowerDialer } from '@/components/dialer/power-dialer';
import { getActiveBrand } from '@/lib/active-brand';
import { getOutboundFromNumber } from '@/lib/dialer';
import { loadDispositions } from '@/lib/dispositions';
import { loadDialQueue } from '@/lib/dial-queue';

type SearchParams = Promise<{
  to?: string;
  leadId?: string;
  // Power-dialer mode: when listId is set, we boot into queued auto-dial.
  list?: string;
  q?: string;
  source?: string;
  tags?: string;
}>;

export default async function DialerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const active = await getActiveBrand();
  const sp = await searchParams;
  const queueMode = !!(sp.list || sp.q || sp.source || sp.tags);

  const [fromNumber, dispositions] = active
    ? await Promise.all([getOutboundFromNumber(active.id), loadDispositions(active.id)])
    : [null, []];

  const queue =
    active && queueMode
      ? await loadDialQueue(active.id, {
          listId: sp.list ?? null,
          search: sp.q ?? null,
          source: sp.source ?? null,
          tagIds: sp.tags
            ? sp.tags.split(',').map((s) => s.trim()).filter(Boolean)
            : null,
          // Don't redial leads we just rang in the last 4h.
          recentlyCalledMinutes: 240,
          limit: 500,
        })
      : [];

  const subtitle = !active
    ? 'No active brand'
    : queueMode
      ? `Power dialer · ${queue.length} lead${queue.length === 1 ? '' : 's'} queued${
          fromNumber ? ` · from ${fromNumber.e164}` : ''
        }`
      : fromNumber
        ? `Outbound from ${fromNumber.e164}${fromNumber.label ? ` (${fromNumber.label})` : ''} · ${active.name}`
        : `No outbound number assigned to ${active.name}`;

  return (
    <>
      <PageHeader title="Dialer" subtitle={subtitle} />
      <div className="flex-1 overflow-auto p-6">
        {queueMode ? (
          <PowerDialer
            brandName={active?.name ?? null}
            fromE164={fromNumber?.e164 ?? null}
            dispositions={dispositions}
            queue={queue}
          />
        ) : (
          <WebRTCDialPad
            brandName={active?.name ?? null}
            fromE164={fromNumber?.e164 ?? null}
            initialNumber={sp.to ?? null}
            initialLeadId={sp.leadId ?? null}
            dispositions={dispositions}
          />
        )}
      </div>
    </>
  );
}
