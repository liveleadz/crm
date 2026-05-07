'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';

export type OAuthAccountSummary = {
  id: string;
  provider: 'google';
  accountEmail: string;
  scopes: string[];
  createdAt: string;
};

// Lists every OAuth account row for the current member. Used by the
// connections page so users see one card per connected Google account
// (vs. the legacy single-blob view).
export async function listMyOAuthAccounts(): Promise<OAuthAccountSummary[]> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const admin = createAdminClient();
  const { data } = await admin
    .from('member_oauth_accounts')
    .select('id, provider, account_email, scopes, created_at')
    .eq('member_id', user.id)
    .order('created_at', { ascending: true });
  return (data ?? [])
    .filter((r) => r.provider === 'google' && r.account_email)
    .map((r) => ({
      id: r.id,
      provider: 'google' as const,
      accountEmail: r.account_email!,
      scopes: r.scopes ?? [],
      createdAt: r.created_at,
    }));
}

// Disconnects a single OAuth account. Mirrors the cleanup behaviour of
// disconnectProvider but scoped to this account only:
//   - Calendars bound to it lose their binding (and any in-flight pushed
//     appointments flip to 'failed' so the cron retries / surfaces the
//     error once the owner re-binds).
//   - If the disconnected account is the one currently mirrored into
//     legacy members.email_oauth, clear those legacy columns too so
//     email send/pull stops silently using a now-revoked grant.
//   - Delete the row.
export async function disconnectOAuthAccount(input: { accountId: string }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const admin = createAdminClient();
  const { data: account } = await admin
    .from('member_oauth_accounts')
    .select('id, member_id, provider, account_email')
    .eq('id', input.accountId)
    .maybeSingle();
  if (!account || account.member_id !== user.id) {
    return { ok: false as const, error: 'Account not found' };
  }

  // Unbind any calendars pointing at this account.
  const { data: cals } = await admin
    .from('calendars')
    .select('id')
    .eq('owner_account_id', input.accountId);
  const calendarIds = (cals ?? []).map((c) => c.id);
  if (calendarIds.length > 0) {
    await admin
      .from('calendars')
      .update({
        ext_provider: null,
        ext_calendar_id: null,
        owner_account_id: null,
        ext_sync_token: null,
        ext_last_sync_at: null,
      })
      .in('id', calendarIds);
    await admin
      .from('appointments')
      .update({ ext_status: 'failed' })
      .in('calendar_id', calendarIds)
      .eq('ext_status', 'pushed');
  }

  // If this account is the one mirrored to members.email_oauth, clear it.
  const { data: memberRow } = await admin
    .from('members')
    .select('email_oauth')
    .eq('id', user.id)
    .maybeSingle();
  const mirroredEmail =
    ((memberRow?.email_oauth as { account_email?: string | null } | null)?.account_email ?? '').toLowerCase();
  if (mirroredEmail && mirroredEmail === (account.account_email ?? '').toLowerCase()) {
    await admin
      .from('members')
      .update({ email_provider: null, email_oauth: null, oauth_scopes: [] })
      .eq('id', user.id);
  }

  await admin.from('member_oauth_accounts').delete().eq('id', input.accountId);

  revalidatePath('/settings/connections');
  revalidatePath('/settings/calendars');
  return { ok: true as const };
}
