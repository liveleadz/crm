import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type EmailThreadRow = {
  id: string;
  leadId: string | null;
  memberId: string;
  extThreadId: string;
  subject: string | null;
  snippet: string | null;
  lastMessageAt: string | null;
};

export type EmailMessageRow = {
  id: string;
  threadId: string;
  direction: 'outbound' | 'inbound';
  extMessageId: string;
  fromAddr: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  sentAt: string;
  memberId: string | null;
};

export async function loadLeadThreads(leadId: string): Promise<EmailThreadRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('email_threads')
    .select('id, lead_id, member_id, ext_thread_id, subject, snippet, last_message_at')
    .eq('lead_id', leadId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(50);
  return (data ?? []).map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    memberId: r.member_id,
    extThreadId: r.ext_thread_id,
    subject: r.subject,
    snippet: r.snippet,
    lastMessageAt: r.last_message_at,
  }));
}

export async function loadThreadMessages(threadId: string): Promise<EmailMessageRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('email_messages')
    .select(
      'id, thread_id, direction, ext_message_id, from_addr, to_addrs, cc_addrs, subject, snippet, body_text, body_html, sent_at, member_id',
    )
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true })
    .limit(200);
  return (data ?? []).map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    direction: r.direction as 'outbound' | 'inbound',
    extMessageId: r.ext_message_id,
    fromAddr: r.from_addr,
    toAddrs: r.to_addrs ?? [],
    ccAddrs: r.cc_addrs ?? [],
    subject: r.subject,
    snippet: r.snippet,
    bodyText: r.body_text,
    bodyHtml: r.body_html,
    sentAt: r.sent_at,
    memberId: r.member_id,
  }));
}
