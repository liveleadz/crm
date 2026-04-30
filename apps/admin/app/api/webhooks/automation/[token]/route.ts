// Public receiver for webhook-triggered automations. The `token` segment is
// the unique opaque secret stored on automations.webhook_token. Anyone with
// the URL can fire the workflow — guard the URL like a credential.
//
// Auth model (per plan): per-workflow secret token in URL only. No HMAC.
// 404 on unknown token; 423 (Locked) when the workflow is disabled. We
// always return JSON so callers can introspect.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { runWebhookAutomation } from '@/lib/automation-engine';
import type { AutomationAction, WorkflowGraph } from '@/lib/automations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ ok: false, error: 'missing token' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: automation } = await supabase
    .from('automations')
    .select('id, name, brand_id, trigger_type, is_enabled, mode, actions, graph')
    .eq('webhook_token', token)
    .maybeSingle();

  if (!automation) {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  if (automation.trigger_type !== 'webhook_received') {
    return NextResponse.json({ ok: false, error: 'wrong trigger type' }, { status: 409 });
  }
  if (!automation.is_enabled) {
    return NextResponse.json({ ok: false, error: 'disabled' }, { status: 423 });
  }

  // Body parse: prefer JSON, fall back to text. Empty bodies are OK.
  let body: unknown = null;
  const contentType = req.headers.get('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) {
      body = await req.json();
    } else {
      const text = await req.text();
      body = text ? text : null;
    }
  } catch {
    body = null;
  }

  // Materialize headers as a plain object — Headers is iterable but most
  // template consumers expect a JSON-style record.
  const headerObj: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headerObj[key] = value;
  });

  try {
    await runWebhookAutomation({
      automation: {
        id: automation.id,
        name: automation.name,
        mode: automation.mode,
        actions: (automation.actions as unknown as AutomationAction[]) ?? [],
        graph: (automation.graph as unknown as WorkflowGraph | null) ?? null,
        brandId: automation.brand_id,
      },
      body,
      headers: headerObj,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

// Support GET as a "ping" so tools like Zapier / Pipedream can health-check
// the URL. This does NOT trigger the workflow.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('automations')
    .select('id, name, is_enabled, trigger_type')
    .eq('webhook_token', token)
    .maybeSingle();
  if (!data || data.trigger_type !== 'webhook_received') {
    return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, name: data.name, enabled: data.is_enabled });
}
