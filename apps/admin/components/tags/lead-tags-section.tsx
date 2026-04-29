'use client';

import { useEffect, useState } from 'react';
import { getLeadTags } from '@/app/actions/tags';
import type { Tag } from '@/lib/tags';
import { TagPicker } from './tag-picker';

// Wrapper that fetches the lead's current tags then mounts the inline picker.
// Used inside the lead detail drawer so the picker has the right initial chips.
export function LeadTagsSection({ leadId }: { leadId: string }) {
  const [tags, setTags] = useState<Tag[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLeadTags(leadId).then((t) => {
      if (!cancelled) setTags(t);
    });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  return (
    <>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-txt-3">
        Tags
      </h4>
      {tags === null ? (
        <p className="text-[12px] text-txt-3">Loading…</p>
      ) : (
        <TagPicker leadId={leadId} initialTags={tags} />
      )}
    </>
  );
}
