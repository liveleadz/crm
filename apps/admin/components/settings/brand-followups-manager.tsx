'use client';

// Brand-wide follow-up templates per disposition. Reuses the FollowupRow
// component from the campaign editor with campaignId=null (= brand default).

import { FollowupRow } from '@/components/campaigns/campaign-editor';
import type { DispositionFollowup } from '@/lib/disposition-followups';
import { useState } from 'react';

type Disposition = { id: string; code: string; label: string; tone: string };
type StageOpt = { id: string; name: string };
type TagOpt = { id: string; name: string; color: string | null };

export function BrandFollowupsManager({
  dispositions,
  followups,
  stages,
  tags,
}: {
  dispositions: Disposition[];
  followups: DispositionFollowup[];
  stages: StageOpt[];
  tags: TagOpt[];
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}
      {dispositions.map((d) => (
        <FollowupRow
          key={d.id}
          campaignId={null}
          disposition={d}
          initial={followups.find((f) => f.dispositionId === d.id) ?? null}
          stages={stages}
          tags={tags}
          canManage={true}
          onError={setError}
        />
      ))}
    </div>
  );
}
