import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { PageHeader } from '@/components/page-header';
import { ConnectionCard } from '@/components/settings/connection-card';
import { SignatureEditor } from '@/components/settings/signature-editor';

type ConnectedShape = {
  provider: 'google' | null;
  accountEmail: string | null;
  scopes: string[];
  signature: string;
};

async function loadConnection(memberId: string): Promise<ConnectedShape> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('members')
    .select('email_provider, email_oauth, oauth_scopes, email_signature')
    .eq('id', memberId)
    .maybeSingle();
  const provider = data?.email_provider === 'google' ? 'google' : null;
  const oauth = (data?.email_oauth ?? null) as { account_email?: string } | null;
  return {
    provider,
    accountEmail: oauth?.account_email ?? null,
    scopes: data?.oauth_scopes ?? [],
    signature: data?.email_signature ?? '',
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
        subtitle="Connect your Google account to send email and sync calendars"
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
          <p className="text-[11.5px] text-txt-3">
            Connect grants calendar + email scopes. Email is used to send and
            read replies on behalf of you from the lead detail composer.
          </p>
          {conn.scopes.includes('email') && (
            <SignatureEditor initial={conn.signature} />
          )}
        </div>
      </div>
    </>
  );
}
