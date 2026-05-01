import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
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

  // Email-send context for the composer + reply UX. Rendered server-side
  // so we don't flash a "Compose" button before knowing the user's scope.
  const admin = createAdminClient();
  const { data: m } = user
    ? await admin
        .from('members')
        .select('email_provider, email_oauth, oauth_scopes, email_signature')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null };
  const oauth = (m?.email_oauth ?? null) as { account_email?: string } | null;
  const canSend =
    !!m && m.email_provider === 'google' && (m.oauth_scopes ?? []).includes('email');

  return (
    <>
      <PageHeader
        title="Conversations"
        subtitle={`${threads.length} thread${threads.length === 1 ? '' : 's'} · email`}
      />
      <ConversationsView
        threads={threads}
        scope={mineOnly ? 'mine' : 'all'}
        initialThreadId={initialThreadId}
        currentMemberId={user?.id ?? null}
        canSend={canSend}
        fromAddr={canSend ? oauth?.account_email ?? null : null}
        signature={m?.email_signature ?? null}
      />
    </>
  );
}
