import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { PageHeader } from '@/components/page-header';
import { ConnectionCard } from '@/components/settings/connection-card';
import { SignatureEditor } from '@/components/settings/signature-editor';

type AccountRow = {
  id: string;
  accountEmail: string;
  scopes: string[];
};

async function loadAccounts(memberId: string): Promise<{
  accounts: AccountRow[];
  primaryEmail: string | null;
  signature: string;
  legacyScopes: string[];
}> {
  const admin = createAdminClient();
  const [{ data: rows }, { data: member }] = await Promise.all([
    admin
      .from('member_oauth_accounts')
      .select('id, account_email, scopes')
      .eq('member_id', memberId)
      .eq('provider', 'google')
      .order('created_at', { ascending: true }),
    admin
      .from('members')
      .select('email_oauth, email_signature, oauth_scopes')
      .eq('id', memberId)
      .maybeSingle(),
  ]);
  const accounts: AccountRow[] = (rows ?? [])
    .filter((r) => r.account_email)
    .map((r) => ({
      id: r.id,
      accountEmail: r.account_email!,
      scopes: r.scopes ?? [],
    }));
  const primaryEmail =
    ((member?.email_oauth as { account_email?: string | null } | null)?.account_email ?? null)?.toLowerCase() ??
    null;
  return {
    accounts,
    primaryEmail,
    signature: member?.email_signature ?? '',
    legacyScopes: member?.oauth_scopes ?? [],
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
  const { accounts, primaryEmail, signature, legacyScopes } = await loadAccounts(user.id);
  const ret = encodeURIComponent('/settings/connections');
  const addUrl = `/api/oauth/google/start?intent=email&return_to=${ret}`;

  return (
    <>
      <PageHeader
        title="Connections"
        subtitle="Connect your Google accounts to send email and sync calendars"
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
          {accounts.length === 0 ? (
            <ConnectionCard
              provider="google"
              accountId={null}
              accountEmail={null}
              scopes={[]}
            />
          ) : (
            <>
              {accounts.map((a) => (
                <ConnectionCard
                  key={a.id}
                  provider="google"
                  accountId={a.id}
                  accountEmail={a.accountEmail}
                  scopes={a.scopes}
                  isPrimary={
                    primaryEmail !== null &&
                    primaryEmail === a.accountEmail.toLowerCase()
                  }
                />
              ))}
              <div className="flex justify-end">
                <a
                  href={addUrl}
                  className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] font-medium hover:bg-surface-2"
                >
                  + Connect another Google account
                </a>
              </div>
            </>
          )}
          <p className="text-[11.5px] text-txt-3">
            Each account can be bound to its own LeadPilot calendar in
            Settings → Calendars. The first account you connect is the
            primary one used for email sending.
          </p>
          {legacyScopes.includes('email') && (
            <>
              <SignatureEditor initial={signature} />
              <div className="rounded-2xl border border-line bg-surface p-5 text-[12px] leading-relaxed text-txt-2">
                <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-txt-3">
                  Improving deliverability
                </h4>
                <p className="mb-2 text-txt-3">
                  Cold first-touch emails frequently land in Spam or Promotions.
                  Gmail learns your reputation over weeks — these practices keep
                  you out of the spam folder:
                </p>
                <ul className="ml-4 list-disc space-y-1 text-txt-2">
                  <li>
                    <span className="font-medium text-txt-1">Warm up the account.</span>{' '}
                    Start with 5–10 sends/day for the first two weeks. Reply to
                    your own outbound from another inbox to build engagement signal.
                  </li>
                  <li>
                    <span className="font-medium text-txt-1">Avoid spam triggers.</span>{' '}
                    Skip ALL CAPS, excessive punctuation, money symbols, and
                    words like "free", "guarantee", "act now", "100%".
                  </li>
                  <li>
                    <span className="font-medium text-txt-1">Personalize.</span>{' '}
                    Reference the lead by name and something specific. Generic
                    blasts are flagged fast.
                  </li>
                  <li>
                    <span className="font-medium text-txt-1">Keep it short and link-light.</span>{' '}
                    1–2 paragraphs, at most 1 link, no tracking pixels on cold mail.
                  </li>
                  <li>
                    <span className="font-medium text-txt-1">Custom domain?</span>{' '}
                    If you send from a Google Workspace domain, configure SPF,
                    DKIM, and DMARC in your DNS — see{' '}
                    <a
                      href="https://support.google.com/a/answer/33786"
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal hover:underline"
                    >
                      Google&apos;s setup guide
                    </a>
                    . @gmail.com addresses are already authenticated.
                  </li>
                  <li>
                    <span className="font-medium text-txt-1">Ask the lead to reply.</span>{' '}
                    Once a recipient replies once, future mail from you almost
                    always lands in their primary tab.
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
