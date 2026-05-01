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

export type BrandEmailThreadRow = EmailThreadRow & {
  leadName: string | null;
  leadEmail: string | null;
  memberName: string | null;
};

// Lists every thread for a brand, joined with lead + member display
// info. Used by the global Inbox view. When mineMemberId is provided
// the query restricts to that member's threads (the "Mine" filter).
export async function loadBrandThreads(
  brandId: string,
  options: { mineMemberId?: string | null; limit?: number } = {},
): Promise<BrandEmailThreadRow[]> {
  const supabase = await createServerClient();
  let query = supabase
    .from('email_threads')
    .select(
      'id, lead_id, member_id, ext_thread_id, subject, snippet, last_message_at, leads(first_name, last_name, email)',
    )
    .eq('brand_id', brandId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(options.limit ?? 100);
  if (options.mineMemberId) query = query.eq('member_id', options.mineMemberId);
  const { data } = await query;
  const rows = data ?? [];

  const memberIds = Array.from(
    new Set(rows.map((r) => r.member_id).filter(Boolean)),
  );
  const memberById = new Map<string, string>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, full_name, email')
      .in('id', memberIds);
    for (const m of members ?? []) {
      memberById.set(m.id, m.full_name?.trim() || m.email);
    }
  }

  return rows.map((r) => {
    const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
    const leadName = lead
      ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
      : null;
    return {
      id: r.id,
      leadId: r.lead_id,
      memberId: r.member_id,
      extThreadId: r.ext_thread_id,
      subject: r.subject,
      snippet: r.snippet,
      lastMessageAt: r.last_message_at,
      leadName,
      leadEmail: lead?.email ?? null,
      memberName: memberById.get(r.member_id) ?? null,
    };
  });
}

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
