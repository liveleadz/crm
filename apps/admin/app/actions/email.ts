'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { getActiveBrand } from '@/lib/active-brand';
import {
  loadLeadThreads,
  loadThreadMessages,
  type EmailMessageRow,
  type EmailThreadRow,
} from '@/lib/email/threads';
import { sendMessage } from '@/lib/email/google';

// Returns thread list + messages of the most-recently-active thread for
// the lead. Used by the lead-detail email section to render in one round
// trip. Empty arrays when the lead has no email history.
export async function getLeadEmail(input: { leadId: string }): Promise<{
  ok: true;
  threads: EmailThreadRow[];
  activeThreadId: string | null;
  messages: EmailMessageRow[];
  canSend: boolean;
  fromAddr: string | null;
  signature: string | null;
}> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const threads = await loadLeadThreads(input.leadId);
  const activeThreadId = threads[0]?.id ?? null;
  const messages = activeThreadId ? await loadThreadMessages(activeThreadId) : [];

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

  return {
    ok: true,
    threads,
    activeThreadId,
    messages,
    canSend,
    fromAddr: oauth?.account_email ?? null,
    signature: m?.email_signature ?? null,
  };
}

export async function getEmailThreadMessages(input: { threadId: string }): Promise<{
  ok: true;
  messages: EmailMessageRow[];
}> {
  const messages = await loadThreadMessages(input.threadId);
  return { ok: true, messages };
}

// Sends an email from the caller's connected Gmail to the lead's email.
// Inserts the resulting Gmail thread + message rows into our DB so the
// thread renders in the CRM immediately (rather than waiting for the
// inbound cron tick). When `threadId` is provided, the message is sent
// as a reply within that Gmail thread; otherwise a fresh thread starts.
export async function sendEmailToLead(input: {
  leadId: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  threadId?: string | null;
}): Promise<
  { ok: true; threadId: string; messageId: string } | { ok: false; error: string }
> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand' };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };

  const subject = input.subject.trim();
  const bodyHtml = input.bodyHtml.trim();
  if (!subject) return { ok: false, error: 'Subject is required' };
  if (!bodyHtml) return { ok: false, error: 'Body is required' };

  // Caller must have email scope.
  const admin = createAdminClient();
  const { data: m } = await admin
    .from('members')
    .select('email_provider, email_oauth, oauth_scopes, full_name, email_signature')
    .eq('id', user.id)
    .maybeSingle();
  const oauth = (m?.email_oauth ?? null) as { account_email?: string } | null;
  if (!m || m.email_provider !== 'google' || !(m.oauth_scopes ?? []).includes('email')) {
    return { ok: false, error: 'Email is not connected. Visit /settings/connections.' };
  }
  if (!oauth?.account_email) {
    return { ok: false, error: 'Connected Google account is missing an email address.' };
  }

  // Lead lookup — must be in the active brand and not opted out.
  const { data: lead } = await supabase
    .from('leads')
    .select('id, brand_id, email, do_not_email')
    .eq('id', input.leadId)
    .maybeSingle();
  if (!lead) return { ok: false, error: 'Lead not found' };
  if (lead.brand_id !== active.id) return { ok: false, error: 'Forbidden' };
  if (!lead.email) return { ok: false, error: 'Lead has no email address' };
  if (lead.do_not_email) return { ok: false, error: 'Lead is opted out of email' };

  // For replies: fetch the prior message's RFC822 Message-ID for In-Reply-To.
  let inReplyTo: string | null = null;
  let references: string[] = [];
  let extThreadId: string | null = null;
  if (input.threadId) {
    const { data: t } = await supabase
      .from('email_threads')
      .select('ext_thread_id')
      .eq('id', input.threadId)
      .maybeSingle();
    if (!t) return { ok: false, error: 'Thread not found' };
    extThreadId = t.ext_thread_id;
    // Best-effort: pick the most recent message's stored ext_message_id.
    // We stored the Gmail messageId there; Gmail will accept that as the
    // header reference because their server returns it as Message-ID for
    // sent messages.
    const { data: prior } = await supabase
      .from('email_messages')
      .select('ext_message_id')
      .eq('thread_id', input.threadId)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prior?.ext_message_id) {
      inReplyTo = `<${prior.ext_message_id}>`;
      references = [`<${prior.ext_message_id}>`];
    }
  }

  let result;
  try {
    result = await sendMessage({
      memberId: user.id,
      fromAddr: oauth.account_email,
      fromName: m.full_name ?? null,
      toAddrs: [lead.email],
      subject,
      bodyHtml,
      bodyText: input.bodyText ?? null,
      inReplyTo,
      references,
      threadId: extThreadId,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  // Upsert thread + insert message. We use the user's session client so
  // RLS still applies (and so the inserted rows are visible immediately).
  const sentAt = new Date().toISOString();
  const snippet = textSnippet(input.bodyText ?? stripHtml(bodyHtml));

  let dbThreadId = input.threadId ?? null;
  if (!dbThreadId) {
    const { data: existing } = await supabase
      .from('email_threads')
      .select('id')
      .eq('member_id', user.id)
      .eq('ext_thread_id', result.threadId)
      .maybeSingle();
    dbThreadId = existing?.id ?? null;
  }

  if (!dbThreadId) {
    const { data: ins, error: insErr } = await supabase
      .from('email_threads')
      .insert({
        brand_id: active.id,
        lead_id: lead.id,
        member_id: user.id,
        ext_provider: 'google',
        ext_thread_id: result.threadId,
        subject,
        snippet,
        last_message_at: sentAt,
      })
      .select('id')
      .single();
    if (insErr || !ins) {
      return { ok: false, error: insErr?.message ?? 'Failed to record thread' };
    }
    dbThreadId = ins.id;
  } else {
    await supabase
      .from('email_threads')
      .update({ subject, snippet, last_message_at: sentAt })
      .eq('id', dbThreadId);
  }

  const { error: msgErr } = await supabase.from('email_messages').insert({
    thread_id: dbThreadId,
    direction: 'outbound',
    ext_message_id: result.id,
    from_addr: oauth.account_email,
    to_addrs: [lead.email],
    subject,
    snippet,
    body_html: bodyHtml,
    body_text: input.bodyText ?? null,
    sent_at: sentAt,
    member_id: user.id,
  });
  if (msgErr) {
    return { ok: false, error: msgErr.message };
  }

  revalidatePath('/leads');
  return { ok: true, threadId: dbThreadId, messageId: result.id };
}

export async function updateMyEmailSignature(input: {
  signature: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated' };
  const trimmed = input.signature.trim();
  const admin = createAdminClient();
  await admin
    .from('members')
    .update({ email_signature: trimmed || null })
    .eq('id', user.id);
  revalidatePath('/settings/connections');
  return { ok: true };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function textSnippet(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 240 ? `${t.slice(0, 237)}…` : t;
}
