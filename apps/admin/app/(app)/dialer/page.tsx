import { PageHeader } from '@/components/page-header';
import { DialPad } from '@/components/dialer/dial-pad';
import { getActiveBrand } from '@/lib/active-brand';
import { getMyProfile, getOutboundFromNumber } from '@/lib/dialer';

export default async function DialerPage() {
  const active = await getActiveBrand();
  const [fromNumber, profile] = await Promise.all([
    active ? getOutboundFromNumber(active.id) : Promise.resolve(null),
    getMyProfile(),
  ]);

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
        <DialPad
          brandName={active?.name ?? null}
          fromE164={fromNumber?.e164 ?? null}
          mobilePhone={profile?.mobilePhone ?? null}
        />
      </div>
    </>
  );
}
