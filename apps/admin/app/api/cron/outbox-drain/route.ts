// Provider drain for `message_outbox`. Picks queued email/SMS rows,
// dispatches them through Resend / SignalWire, and writes back the result
// (sent / failed / skipped). Scheduled by vercel.json at /apps/admin/vercel.json.
//
// Auth: Vercel Cron auto-injects Authorization: Bearer ${CRON_SECRET}. Manual
// calls must include the same header. Without CRON_SECRET set, the route is
// open (dev convenience).
//
// Concurrency: rows are claimed via a status update (queued -> sending) before
// the network call so two crons that fire in the same window can't double-send.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { sendSignalWireSms } from '@/lib/signalwire';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BATCH = 20;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from('message_outbox')
    .select('id, brand_id, channel, to_addr, from_addr, subject, body, attempts')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const queued = rows ?? [];
  if (queued.length === 0) {
    return NextResponse.json({ ok: true, drained: 0 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of queued) {
    // Claim the row first so concurrent ticks don't double-send.
    const { error: claimErr } = await supabase
      .from('message_outbox')
      .update({ status: 'sending', attempts: (row.attempts ?? 0) + 1 })
      .eq('id', row.id)
      .eq('status', 'queued');
    if (claimErr) continue;

    try {
      if (row.channel === 'email') {
        const result = await sendEmail({
          to: row.to_addr,
          from: row.from_addr,
          subject: row.subject,
          body: row.body,
        });
        if (result.kind === 'skipped') {
          await markSkipped(supabase, row.id, result.reason);
          skipped++;
        } else if (result.kind === 'sent') {
          await markSent(supabase, row.id, result.providerId);
          sent++;
        } else {
          await markFailed(supabase, row.id, result.error);
          failed++;
        }
      } else if (row.channel === 'sms') {
        const fromNumber = row.from_addr ?? (await pickBrandSendingNumber(supabase, row.brand_id));
        if (!fromNumber) {
          await markSkipped(supabase, row.id, 'no SMS-capable from number for brand');
          skipped++;
          continue;
        }
        const r = await sendSignalWireSms({
          from: fromNumber,
          to: row.to_addr,
          body: row.body,
        });
        if (r.ok) {
          await markSent(supabase, row.id, r.data.sid);
          sent++;
        } else {
          await markFailed(supabase, row.id, r.error);
          failed++;
        }
      } else {
        await markSkipped(supabase, row.id, `unknown channel: ${row.channel}`);
        skipped++;
      }
    } catch (e) {
      await markFailed(supabase, row.id, (e as Error).message);
      failed++;
    }
  }

  return NextResponse.json({ ok: true, drained: queued.length, sent, failed, skipped });
}

// ---------------------------------------------------------------------------
// Email via Resend
// ---------------------------------------------------------------------------

type EmailResult =
  | { kind: 'sent'; providerId: string }
  | { kind: 'failed'; error: string }
  | { kind: 'skipped'; reason: string };

async function sendEmail(input: {
  to: string;
  from: string | null;
  subject: string | null;
  body: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { kind: 'skipped', reason: 'RESEND_API_KEY not configured' };
  const from = input.from ?? process.env.RESEND_FROM_EMAIL ?? null;
  if (!from) return { kind: 'skipped', reason: 'no from address; set RESEND_FROM_EMAIL' };

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject ?? '(no subject)',
        text: input.body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { kind: 'failed', error: `network: ${(e as Error).message}` };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { kind: 'failed', error: `${res.status} ${body.slice(0, 240)}` };
  }
  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  return { kind: 'sent', providerId: json?.id ?? '' };
}

// ---------------------------------------------------------------------------
// Outbox status writers
// ---------------------------------------------------------------------------

type Sb = ReturnType<typeof createAdminClient>;

async function markSent(supabase: Sb, id: string, providerId: string) {
  await supabase
    .from('message_outbox')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      provider_message_id: providerId || null,
      error: null,
    })
    .eq('id', id);
}

async function markFailed(supabase: Sb, id: string, error: string) {
  await supabase
    .from('message_outbox')
    .update({ status: 'failed', error: error.slice(0, 500) })
    .eq('id', id);
}

async function markSkipped(supabase: Sb, id: string, reason: string) {
  await supabase
    .from('message_outbox')
    .update({ status: 'skipped', error: reason.slice(0, 500) })
    .eq('id', id);
}

// Pick any SMS-capable number for the brand to use as the From address. We
// fall back to the first numbers row; carriers reject mismatched senders so a
// real deployment should set from_addr explicitly when authoring SMS actions.
async function pickBrandSendingNumber(supabase: Sb, brandId: string): Promise<string | null> {
  const { data } = await supabase
    .from('numbers')
    .select('e164')
    .eq('brand_id', brandId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.e164 ?? null;
}
