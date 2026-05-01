import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { PageHeader } from '@/components/page-header';
import { ConnectionCard } from '@/components/settings/connection-card';

type ConnectedShape = {
  provider: 'google' | 'microsoft' | null;
  accountEmail: string | null;
  scopes: string[];
};

async function loadConnection(memberId: string): Promise<ConnectedShape> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('members')
    .select('email_provider, email_oauth, oauth_scopes')
    .eq('id', memberId)
    .maybeSingle();
  const provider = (data?.email_provider ?? null) as 'google' | 'microsoft' | null;
  const oauth = (data?.email_oauth ?? null) as { account_email?: string } | null;
  return {
    provider,
    accountEmail: oauth?.account_email ?? null,
    scopes: data?.oauth_scopes ?? [],
  };
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams?: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const conn = await loadConnection(user.id);

  return (
    <>
      <PageHeader
        title="Connections"
        subtitle="Connect your Google or Microsoft account to sync calendars"
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {sp.connected && (
            <div className="rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-[12px] text-teal">
              Connected {sp.connected}.
            </div>
          )}
          {sp.error && (
            <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
              {sp.error}
            </div>
          )}
          <ConnectionCard
            provider="google"
            connected={conn.provider === 'google'}
            accountEmail={conn.provider === 'google' ? conn.accountEmail : null}
            scopes={conn.provider === 'google' ? conn.scopes : []}
          />
          <ConnectionCard
            provider="microsoft"
            connected={conn.provider === 'microsoft'}
            accountEmail={conn.provider === 'microsoft' ? conn.accountEmail : null}
            scopes={conn.provider === 'microsoft' ? conn.scopes : []}
          />
          <p className="text-[11.5px] text-txt-3">
            Phase 1 grants calendar scope only. Email send + read scopes will be
            added when email is enabled.
          </p>
        </div>
      </div>
    </>
  );
}
