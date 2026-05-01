import 'server-only';
import { createAdminClient } from '@leadpilot/db/admin';
import {
  extractBodies,
  findHeader,
  getMessage,
  getProfile,
  listHistory,
  parseAddressList,
  type GmailMessage,
} from './google';

// Pulls inbound Gmail history for one member and reconciles it into
// email_threads + email_messages. Best-effort. On the first sync the
// member has no checkpoint — we seed last_history_id from the user's
// profile and return (we do not backfill historical mail in Phase 2).
//
// Returns counts so the cron route can log a summary.
export async function pullForMember(memberId: string): Promise<{
  inserted: number;
  skipped: number;
}> {
  const admin = createAdminClient();

  const { data: m } = await admin
    .from('members')
    .select('email_provider, email_oauth, oauth_scopes')
    .eq('id', memberId)
    .maybeSingle();
  const oauth = (m?.email_oauth ?? null) as { account_email?: string } | null;
  if (
    !m ||
    m.email_provider !== 'google' ||
    !(m.oauth_scopes ?? []).includes('email') ||
    !oauth?.account_email
  ) {
    return { inserted: 0, skipped: 0 };
  }
  const memberEmail = oauth.account_email.toLowerCase();

  const { data: state } = await admin
    .from('email_sync_state')
    .select('last_history_id')
    .eq('member_id', memberId)
    .maybeSingle();

  // First sync: seed checkpoint and return. Future ticks pull deltas.
  if (!state?.last_history_id) {
    const profile = await getProfile(memberId).catch(() => null);
    if (!profile) return { inserted: 0, skipped: 0 };
    await admin
      .from('email_sync_state')
      .upsert({
        member_id: memberId,
        last_history_id: profile.historyId,
        last_synced_at: new Date().toISOString(),
        last_error: null,
      });
    return { inserted: 0, skipped: 0 };
  }

  let history;
  try {
    history = await listHistory({
      memberId,
      startHistoryId: state.last_history_id,
    });
  } catch (e) {
    await admin
      .from('email_sync_state')
      .update({ last_error: (e as Error).message.slice(0, 240) })
      .eq('member_id', memberId);
    return { inserted: 0, skipped: 0 };
  }

  // historyId expired or 410 → reseed and skip this tick. We accept the
  // missed window as a Phase 2 trade-off; Phase 2.5 push will close it.
  if (!history.nextHistoryId) {
    const profile = await getProfile(memberId).catch(() => null);
    if (profile) {
      await admin
        .from('email_sync_state')
        .upsert({
          member_id: memberId,
          last_history_id: profile.historyId,
          last_synced_at: new Date().toISOString(),
          last_error: 'history reseeded',
        });
    }
    return { inserted: 0, skipped: 0 };
  }

  // Collect distinct messageIds from messagesAdded — we ignore deletions
  // and label changes for Phase 2 (read state isn't surfaced anywhere).
  const messageIds = new Set<string>();
  for (const rec of history.records) {
    for (const ma of rec.messagesAdded ?? []) {
      messageIds.add(ma.message.id);
    }
  }

  let inserted = 0;
  let skipped = 0;

  for (const id of messageIds) {
    let msg: GmailMessage;
    try {
      msg = await getMessage({ memberId, messageId: id, format: 'full' });
    } catch {
      skipped += 1;
      continue;
    }
    const result = await reconcileMessage({ admin, memberId, memberEmail, msg });
    if (result === 'inserted') inserted += 1;
    else skipped += 1;
  }

  await admin
    .from('email_sync_state')
    .upsert({
      member_id: memberId,
      last_history_id: history.nextHistoryId,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    });

  return { inserted, skipped };
}

// Reconciles one Gmail message into our DB. Returns 'inserted' when a
// new row was added, otherwise 'skipped' (already known, no lead match,
// or outbound-from-self-without-thread).
async function reconcileMessage(input: {
  admin: ReturnType<typeof createAdminClient>;
  memberId: string;
  memberEmail: string;
  msg: GmailMessage;
}): Promise<'inserted' | 'skipped'> {
  const { admin, memberId, memberEmail, msg } = input;

  const fromHdr = findHeader(msg.payload, 'From');
  const toHdr = findHeader(msg.payload, 'To');
  const ccHdr = findHeader(msg.payload, 'Cc');
  const subject = findHeader(msg.payload, 'Subject');
  const dateHdr = findHeader(msg.payload, 'Date');

  const fromAddrs = parseAddressList(fromHdr);
  const toAddrs = parseAddressList(toHdr);
  const ccAddrs = parseAddressList(ccHdr);

  const direction: 'inbound' | 'outbound' = fromAddrs.includes(memberEmail)
    ? 'outbound'
    : 'inbound';

  // Sent-from-self: dedupe against rows we already inserted at send-time.
  // Otherwise we could double-write a thread the member sent from another
  // Gmail client. The unique index (thread_id, ext_message_id) protects
  // us from duplicates either way.
  const sentAtIso = parseDate(dateHdr) ?? new Date(Number(msg.internalDate ?? Date.now())).toISOString();
  const { text, html } = extractBodies(msg.payload);
  const fromSingle = fromAddrs[0] ?? null;

  // Find existing thread by (member_id, ext_thread_id).
  const { data: existingThread } = await admin
    .from('email_threads')
    .select('id, brand_id, lead_id')
    .eq('member_id', memberId)
    .eq('ext_thread_id', msg.threadId)
    .maybeSingle();

  let threadId: string;
  let brandId: string;
  let leadId: string | null;

  if (existingThread) {
    threadId = existingThread.id;
    brandId = existingThread.brand_id;
    leadId = existingThread.lead_id;
  } else {
    // No existing thread — try to associate with a lead by the *other
    // party's* address. For inbound, that's the From; for outbound, it's
    // the first To. We restrict the lead lookup to brands the member
    // belongs to, to avoid leaking mail across tenants.
    const candidate =
      direction === 'inbound' ? fromSingle : (toAddrs[0] ?? null);
    if (!candidate) return 'skipped';

    const { data: brandRows } = await admin
      .from('brand_members')
      .select('brand_id')
      .eq('member_id', memberId);
    const brandIds = (brandRows ?? []).map((r) => r.brand_id);
    if (brandIds.length === 0) return 'skipped';

    const { data: lead } = await admin
      .from('leads')
      .select('id, brand_id')
      .in('brand_id', brandIds)
      .ilike('email', candidate)
      .limit(1)
      .maybeSingle();
    if (!lead) return 'skipped';

    const { data: ins, error: insErr } = await admin
      .from('email_threads')
      .insert({
        brand_id: lead.brand_id,
        lead_id: lead.id,
        member_id: memberId,
        ext_provider: 'google',
        ext_thread_id: msg.threadId,
        subject,
        snippet: msg.snippet ?? null,
        last_message_at: sentAtIso,
      })
      .select('id')
      .single();
    if (insErr || !ins) return 'skipped';
    threadId = ins.id;
    brandId = lead.brand_id;
    leadId = lead.id;
  }

  // Insert the message. Conflicts on (thread_id, ext_message_id) are
  // expected for outbound rows we already wrote at send-time.
  const { error: msgErr } = await admin.from('email_messages').insert({
    thread_id: threadId,
    direction,
    ext_message_id: msg.id,
    ext_history_id: msg.historyId ?? null,
    from_addr: fromSingle,
    to_addrs: toAddrs,
    cc_addrs: ccAddrs,
    subject,
    snippet: msg.snippet ?? null,
    body_text: text,
    body_html: html,
    sent_at: sentAtIso,
    member_id: direction === 'outbound' ? memberId : null,
  });
  if (msgErr) {
    // Duplicate (already imported) is fine.
    if (/duplicate key/i.test(msgErr.message)) return 'skipped';
    return 'skipped';
  }

  // Bump thread snippet + last_message_at on the *latest* message.
  await admin
    .from('email_threads')
    .update({
      snippet: msg.snippet ?? null,
      last_message_at: sentAtIso,
      subject: subject ?? undefined,
    })
    .eq('id', threadId);

  // Suppress unused-var warning when imports are pruned later.
  void brandId;
  void leadId;

  return 'inserted';
}

function parseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
