// WebRTC dialer (v2). Lives alongside the PSTN bridge dialer at /dialer
// until end-to-end verification is complete. Once verified, /dialer is
// removed and this page replaces it.

import { PageHeader } from '@/components/page-header';
import { WebRTCDialPad } from '@/components/dialer/webrtc-dial-pad';
import { getActiveBrand } from '@/lib/active-brand';
import { getOutboundFromNumber } from '@/lib/dialer';

export default async function DialerV2Page() {
  const active = await getActiveBrand();
  const fromNumber = active ? await getOutboundFromNumber(active.id) : null;

  return (
    <>
      <PageHeader
        title="Dialer (WebRTC)"
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
        />
      </div>
    </>
  );
}
