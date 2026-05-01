'use server';

// Server action used by the conversations view to refresh the open
// thread on a tight cadence (~10s while the tab is visible). Avoids
// setting up Gmail Pub/Sub by piggybacking on the existing history-id
// based delta sync. Authorization is enforced by reading the thread via
// the RLS-aware client first — if the caller isn't a brand member, the
// row read returns null and we bail.

import { createServerClient } from '@leadpilot/db/server';
import { pullForMember } from '@/lib/email/sync';

type Result =
  | { ok: true; updated: boolean; lastMessageAt: string | null }
  | { ok: false; error: string };

export async function refreshActiveThread(threadId: string): Promise<Result> {
  if (!threadId) return { ok: false, error: 'Missing thread id.' };
  const supabase = await createServerClient();

  // RLS gates this — only brand members can read the thread row.
  const { data: thread } = await supabase
    .from('email_threads')
    .select('id, member_id, last_message_at')
    .eq('id', threadId)
    .maybeSingle();
  if (!thread || !thread.member_id) {
    return { ok: false, error: 'Thread not found.' };
  }

  const before = thread.last_message_at;

  try {
    await pullForMember(thread.member_id);
  } catch (err) {
    console.error('[refreshActiveThread]', err);
    return { ok: false, error: 'Refresh failed.' };
  }

  // Re-read the thread row to see if a new message landed. We compare
  // last_message_at rather than counting messages to keep this cheap.
  const { data: after } = await supabase
    .from('email_threads')
    .select('last_message_at')
    .eq('id', threadId)
    .maybeSingle();
  const lastMessageAt = after?.last_message_at ?? before ?? null;
  const updated = !!after?.last_message_at && after.last_message_at !== before;

  return { ok: true, updated, lastMessageAt };
}
