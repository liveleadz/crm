import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { loadBrandThreads } from '@/lib/email/threads';
import { PageHeader } from '@/components/page-header';
import { ConversationsView } from '@/components/conversations/conversations-view';

// Unified Conversations inbox. Today the only wired channel is email;
// SMS plugs in once A2P 10DLC registration completes and the messages
// table is wired in. The channel filter is rendered in
// ConversationsView so SMS appears as a disabled pill until then.
export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; channel?: string; thread?: string }>;
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
        title="Conversations"
        subtitle={`${threads.length} thread${threads.length === 1 ? '' : 's'} · email${' '}`}
      />
      <ConversationsView
        threads={threads}
        scope={mineOnly ? 'mine' : 'all'}
        initialThreadId={initialThreadId}
        currentMemberId={user?.id ?? null}
      />
    </>
  );
}
