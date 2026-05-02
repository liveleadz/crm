import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { WebRTCDialPad } from '@/components/dialer/webrtc-dial-pad';
import { PowerDialer } from '@/components/dialer/power-dialer';
import { getActiveBrand } from '@/lib/active-brand';
import { getMyProfile, getOutboundFromNumber } from '@/lib/dialer';
import { loadDispositions } from '@/lib/dispositions';
import { loadDialQueue } from '@/lib/dial-queue';
import {
  assertAgentCanRunCampaign,
  loadCampaignScript,
  type Campaign,
} from '@/lib/campaigns';

type SearchParams = Promise<{
  to?: string;
  leadId?: string;
  // Power-dialer mode: when listId is set, we boot into queued auto-dial.
  list?: string;
  q?: string;
  source?: string;
  tags?: string;
  // Campaign mode: bundles script + calendar + lists + agents.
  campaign?: string;
}>;

export default async function DialerPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const active = await getActiveBrand();
  const sp = await searchParams;
  const campaignParam = sp.campaign ?? null;
  const adHocQueueMode = !!(sp.list || sp.q || sp.source || sp.tags);

  // Campaign mode hard-locks: only assigned agents (or manager+) can run.
  let campaign: Campaign | null = null;
  if (active && campaignParam) {
    const profile = await getMyProfile();
    if (!profile) notFound();
    const guard = await assertAgentCanRunCampaign(campaignParam, profile.id);
    if (!guard.ok) notFound();
    campaign = guard.campaign;
  }

  const queueMode = adHocQueueMode || !!campaign;

  const [fromNumber, dispositions, script] = active
    ? await Promise.all([
        getOutboundFromNumber(active.id),
        loadDispositions(active.id),
        campaign ? loadCampaignScript(campaign.scriptId) : Promise.resolve(null),
      ])
    : [null, [], null];

  const queue =
    active && queueMode
      ? await loadDialQueue(active.id, {
          listId: sp.list ?? null,
          search: sp.q ?? null,
          source: sp.source ?? null,
          tagIds: sp.tags
            ? sp.tags.split(',').map((s) => s.trim()).filter(Boolean)
            : null,
          campaignId: campaign?.id ?? null,
          // Don't redial leads we just rang in the last 4h. Campaign mode
          // overrides this from the campaign's recently_called_minutes.
          recentlyCalledMinutes: campaign ? undefined : 240,
          limit: 500,
        })
      : [];

  const subtitle = !active
    ? 'No active brand'
    : campaign
      ? `${campaign.name} · ${queue.length} lead${queue.length === 1 ? '' : 's'} queued${
          fromNumber ? ` · from ${fromNumber.e164}` : ''
        }`
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
            campaignId={campaign?.id ?? null}
            script={script}
            tcpaPolicy={
              campaign
                ? {
                    enabled: campaign.tcpaEnabled,
                    startMin: campaign.dialWindowStartMin,
                    endMin: campaign.dialWindowEndMin,
                    skipWeekends: campaign.skipWeekends,
                  }
                : null
            }
            brandTimezone={active?.timezone ?? 'UTC'}
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
