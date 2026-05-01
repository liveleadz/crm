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
            <>
              <SignatureEditor initial={conn.signature} />
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
