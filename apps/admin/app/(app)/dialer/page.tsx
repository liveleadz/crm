import { PageHeader } from '@/components/page-header';
import { WebRTCDialPad } from '@/components/dialer/webrtc-dial-pad';
import { getActiveBrand } from '@/lib/active-brand';
import { getOutboundFromNumber } from '@/lib/dialer';
import { loadDispositions } from '@/lib/dispositions';

type SearchParams = Promise<{ to?: string; leadId?: string }>;

export default async function DialerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const active = await getActiveBrand();
  const [fromNumber, dispositions] = active
    ? await Promise.all([getOutboundFromNumber(active.id), loadDispositions(active.id)])
    : [null, []];
  const sp = await searchParams;

  return (
    <>
      <PageHeader
        title="Dialer"
        subtitle={
          active && fromNumber
            ? `Outbound from ${fromNumber.e164}${fromNumber.label ? ` (${fromNumber.label})` : ''} · ${active.name}`
            : active
              ? `No outbound number assigned to ${active.name}`
              : 'No active brand'
        }
      />
      <div className="flex-1 overflow-auto p-6">
        <WebRTCDialPad
          brandName={active?.name ?? null}
          fromE164={fromNumber?.e164 ?? null}
          initialNumber={sp.to ?? null}
          initialLeadId={sp.leadId ?? null}
          dispositions={dispositions}
        />
      </div>
    </>
  );
}
