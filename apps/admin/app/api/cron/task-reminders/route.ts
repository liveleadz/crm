// Task reminder dispatcher.
//
// Designed to be invoked by a scheduled trigger (Vercel Cron / Supabase pg_cron
// / external scheduler) every 1-5 minutes. Picks up unsent reminders whose
// remind_at <= now() for tasks still in 'open' status, and sends them via the
// requested channel.
//
// The actual send transports (email via Resend, SMS via SignalWire) are
// stubbed for now — the dispatcher records send_error so reminders can be
// inspected but won't crash. Wire real transports in when those services are
// configured.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service role env not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

type Channel = 'email' | 'sms' | 'in_app';

async function dispatch(_channel: Channel, _payload: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  // TODO: integrate Resend (email) + SignalWire (sms) once configured.
  // For 'in_app' there is no send — surfacing happens in the UI via
  // TaskRow.reminders.
  return { ok: false, error: 'transport not configured' };
}

export async function POST(req: Request) {
  // Bearer-token guard. Set CRON_SECRET in env and pass `Authorization: Bearer <secret>`.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${expected}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabase = getServiceClient();
  const now = new Date().toISOString();

  const { data: due, error } = await supabase
    .from('task_reminders')
    .select('id, channel, task_id, tasks!inner(id, title, status, lead_id, assignee_id)')
    .lte('remind_at', now)
    .is('sent_at', null)
    .eq('tasks.status', 'open')
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const r of due ?? []) {
    if (r.channel === 'in_app') {
      // No-op: surfaced in UI from task_reminders rows.
      await supabase
        .from('task_reminders')
        .update({ sent_at: now })
        .eq('id', r.id);
      sent += 1;
      continue;
    }
    const result = await dispatch(r.channel as Channel, r.tasks);
    if (result.ok) {
      await supabase
        .from('task_reminders')
        .update({ sent_at: new Date().toISOString(), send_error: null })
        .eq('id', r.id);
      sent += 1;
    } else {
      await supabase
        .from('task_reminders')
        .update({ send_error: result.error })
        .eq('id', r.id);
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, sent, failed, considered: due?.length ?? 0 });
}

export async function GET(req: Request) {
  // Convenience: same handler so cron services that only support GET work too.
  return POST(req);
}
