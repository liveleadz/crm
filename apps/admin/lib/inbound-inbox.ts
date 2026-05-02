import 'server-only';
// Inbound inbox: missed calls + voicemails that haven't been triaged.
// "Unhandled" = direction='inbound' AND handled_at IS NULL. The Inbox
// view groups by status (missed/voicemail/handled). The dashboard card
// shows the last 5 unhandled, newest first.

import { createServerClient } from '@leadpilot/db/server';

export type InboxFilter = 'all' | 'missed' | 'voicemail' | 'handled';

export type InboxRow = {
  id: string;
  startedAt: string;
  fromNumber: string;
  toNumber: string;
  durationSec: number | null;
  disposition: string | null;
  isVoicemail: boolean;
  hasRecording: boolean;
  recordingDurationSec: number | null;
  handledAt: string | null;
  handledByName: string | null;
  leadId: string | null;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadPhone: string | null;
};

export async function loadInboundInbox(
  brandId: string,
  filter: InboxFilter = 'all',
  limit = 100,
): Promise<InboxRow[]> {
  const supabase = await createServerClient();
  const base = supabase
    .from('calls')
    .select(
      'id, started_at, from_number, to_number, duration_sec, disposition, is_voicemail, recording_url, recording_duration_sec, handled_at, handled_by, lead_id, leads(first_name, last_name, phone)',
    )
    .eq('brand_id', brandId)
    .eq('direction', 'inbound')
    .order('started_at', { ascending: false })
    .limit(limit);

  // Each branch terminates the chain with its own await so postgrest's
  // narrowed return types (e.g. .not('is', null)) don't collide with a
  // shared variable annotation.
  const { data } =
    filter === 'missed'
      ? await base.eq('is_voicemail', false).is('handled_at', null)
      : filter === 'voicemail'
        ? await base.eq('is_voicemail', true)
        : filter === 'handled'
          ? await base.not('handled_at', 'is', null)
          : // 'all' = currently outstanding inbound (unhandled). Handled rows
            // live in the Handled tab so the default view stays focused.
            await base.is('handled_at', null);
  if (!data) return [];

  // Resolve handler member ids → display names with a single side-query.
  // No FK in postgrest schema between calls.handled_by and members yet,
  // so we can't embed it in the select above.
  const handlerIds = Array.from(
    new Set(
      data
        .map((r) => r.handled_by)
        .filter((v): v is string => typeof v === 'string' && v.length > 0),
    ),
  );
  const handlerNames = new Map<string, string>();
  if (handlerIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, full_name, email')
      .in('id', handlerIds);
    for (const m of members ?? []) {
      const name = (m.full_name?.trim() || m.email) ?? '';
      if (name) handlerNames.set(m.id, name);
    }
  }

  return data.map((r) => {
    const lead = r.leads as
      | { first_name: string | null; last_name: string | null; phone: string | null }
      | null;
    return {
      id: r.id,
      startedAt: r.started_at,
      fromNumber: r.from_number,
      toNumber: r.to_number,
      durationSec: r.duration_sec,
      disposition: r.disposition,
      isVoicemail: Boolean(r.is_voicemail),
      hasRecording: Boolean(r.recording_url),
      recordingDurationSec: r.recording_duration_sec ?? null,
      handledAt: r.handled_at,
      handledByName: r.handled_by ? handlerNames.get(r.handled_by) ?? null : null,
      leadId: r.lead_id,
      leadFirstName: lead?.first_name ?? null,
      leadLastName: lead?.last_name ?? null,
      leadPhone: lead?.phone ?? null,
    };
  });
}

// Cheap count for sidebar badge / dashboard headline. Trailing 7-day
// window to avoid showing a forever-growing number.
export async function countUnhandledInbound(brandId: string): Promise<number> {
  const supabase = await createServerClient();
  const since = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString();
  const { count } = await supabase
    .from('calls')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .eq('direction', 'inbound')
    .is('handled_at', null)
    .gte('started_at', since);
  return count ?? 0;
}
