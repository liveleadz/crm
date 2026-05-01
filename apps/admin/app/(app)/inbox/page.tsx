import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { loadBrandThreads } from '@/lib/email/threads';
import { PageHeader } from '@/components/page-header';
import { InboxView } from '@/components/inbox/inbox-view';

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; thread?: string }>;
}) {
  const active = await getActiveBrand();
  if (!active) return null;
  const sp = await searchParams;
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const mineOnly = sp.scope !== 'all';
  const threads = await loadBrandThreads(active.id, {
    mineMemberId: mineOnly && user ? user.id : null,
  });
  const initialThreadId = sp.thread || threads[0]?.id || null;

  return (
    <>
      <PageHeader
        title="Inbox"
        subtitle={`${threads.length} thread${threads.length === 1 ? '' : 's'}`}
      />
      <InboxView
        threads={threads}
        scope={mineOnly ? 'mine' : 'all'}
        initialThreadId={initialThreadId}
        currentMemberId={user?.id ?? null}
      />
    </>
  );
}
