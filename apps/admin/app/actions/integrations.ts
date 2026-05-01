'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';

export async function disconnectProvider(input: { provider: 'google' | 'microsoft' }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('members')
    .select('email_provider')
    .eq('id', user.id)
    .maybeSingle();

  // Only clear if the connected provider matches; otherwise it's a no-op.
  if (existing?.email_provider && existing.email_provider !== input.provider) {
    return { ok: false as const, error: `Connected provider is ${existing.email_provider}` };
  }

  await admin
    .from('members')
    .update({
      email_provider: null,
      email_oauth: null,
      oauth_scopes: [],
    })
    .eq('id', user.id);

  // Mark any in-flight pushed appointments on this member's owned calendars
  // as failed so the cron retries (which will now error out and surface).
  const { data: cals } = await admin
    .from('calendars')
    .select('id')
    .eq('owner_member_id', user.id)
    .not('ext_provider', 'is', null);
  const calendarIds = (cals ?? []).map((c) => c.id);
  if (calendarIds.length > 0) {
    await admin
      .from('appointments')
      .update({ ext_status: 'failed' })
      .in('calendar_id', calendarIds)
      .eq('ext_status', 'pushed');
  }

  revalidatePath('/settings/connections');
  revalidatePath('/settings/calendars');
  return { ok: true as const };
}
