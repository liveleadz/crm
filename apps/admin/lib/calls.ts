import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type CallRow = {
  id: string;
  startedAt: string;
  direction: 'inbound' | 'outbound';
  disposition: string | null;
  durationSec: number | null;
  fromNumber: string;
  toNumber: string;
  leadId: string | null;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadPhone: string | null;
  hasRecording: boolean;
  recordingDurationSec: number | null;
  transcript: string | null;
  transcriptStatus: 'pending' | 'ready' | 'failed' | 'skipped' | null;
  needsDisposition: boolean;
  note: string | null;
  callbackAt: string | null;
  isVoicemail: boolean;
};

// Default cap of 5000 rows. PostgREST silently truncates .limit() at the
// project's max-rows setting (1000 by default), so we use .range() — that
// bypasses the soft cap and reflects the actual brand history in the
// call log. For brands with more than 5k calls the client-side filter
// will still operate on the most recent 5k; pagination is a follow-up.
export async function loadCalls(brandId: string, limit = 5000): Promise<CallRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('calls')
    .select(
      'id, started_at, direction, disposition, duration_sec, from_number, to_number, lead_id, recording_url, recording_duration_sec, transcript, transcript_status, needs_disposition, note, callback_at, is_voicemail, leads(first_name, last_name, phone)',
    )
    .eq('brand_id', brandId)
    .order('started_at', { ascending: false })
    .range(0, Math.max(0, limit - 1));

  if (!data) return [];
  return data.map((c) => {
    const lead = c.leads as
      | { first_name: string | null; last_name: string | null; phone: string | null }
      | null;
    return {
      id: c.id,
      startedAt: c.started_at,
      direction: c.direction,
      disposition: c.disposition,
      durationSec: c.duration_sec,
      fromNumber: c.from_number,
      toNumber: c.to_number,
      leadId: c.lead_id,
      leadFirstName: lead?.first_name ?? null,
      leadLastName: lead?.last_name ?? null,
      leadPhone: lead?.phone ?? null,
      hasRecording: Boolean(c.recording_url),
      recordingDurationSec: c.recording_duration_sec ?? null,
      transcript: c.transcript ?? null,
      transcriptStatus: (c.transcript_status as CallRow['transcriptStatus']) ?? null,
      needsDisposition: Boolean(c.needs_disposition),
      note: c.note ?? null,
      callbackAt: c.callback_at ?? null,
      isVoicemail: Boolean(c.is_voicemail),
    };
  });
}
