import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { buildVars, renderTemplate } from './automation-templates';

export type DispositionFollowup = {
  id: string;
  brandId: string;
  campaignId: string | null;
  dispositionId: string;
  enabled: boolean;
  sendEmail: boolean;
  emailSubject: string | null;
  emailBody: string | null;
  sendSms: boolean;
  smsBody: string | null;
  createTask: boolean;
  taskTitle: string | null;
  taskDueMinutes: number | null;
  // Lead-state transitions fired alongside the messaging follow-ups.
  moveStageId: string | null;
  addTagIds: string[];
};

type FollowupRow = {
  id: string;
  brand_id: string;
  campaign_id: string | null;
  disposition_id: string;
  enabled: boolean;
  send_email: boolean;
  email_subject: string | null;
  email_body: string | null;
  send_sms: boolean;
  sms_body: string | null;
  create_task: boolean;
  task_title: string | null;
  task_due_minutes: number | null;
  move_stage_id: string | null;
  add_tag_ids: string[] | null;
};

function mapFollowup(row: FollowupRow): DispositionFollowup {
  return {
    id: row.id,
    brandId: row.brand_id,
    campaignId: row.campaign_id,
    dispositionId: row.disposition_id,
    enabled: row.enabled,
    sendEmail: row.send_email,
    emailSubject: row.email_subject,
    emailBody: row.email_body,
    sendSms: row.send_sms,
    smsBody: row.sms_body,
    createTask: row.create_task,
    taskTitle: row.task_title,
    taskDueMinutes: row.task_due_minutes,
    moveStageId: row.move_stage_id,
    addTagIds: row.add_tag_ids ?? [],
  };
}

const SELECT =
  'id, brand_id, campaign_id, disposition_id, enabled, send_email, email_subject, email_body, send_sms, sms_body, create_task, task_title, task_due_minutes, move_stage_id, add_tag_ids';

// Resolve the follow-up template the dialer should use for this
// (campaign, disposition). Campaign override beats brand default. Returns
// null if neither exists or both are disabled.
export async function loadFollowupForDisposition(
  brandId: string,
  campaignId: string | null,
  dispositionId: string,
): Promise<DispositionFollowup | null> {
  const supabase = await createServerClient();
  if (campaignId) {
    const { data: override } = await supabase
      .from('disposition_followups')
      .select(SELECT)
      .eq('campaign_id', campaignId)
      .eq('disposition_id', dispositionId)
      .maybeSingle();
    if (override) {
      const m = mapFollowup(override as FollowupRow);
      if (m.enabled) return m;
    }
  }
  const { data: brandRow } = await supabase
    .from('disposition_followups')
    .select(SELECT)
    .eq('brand_id', brandId)
    .is('campaign_id', null)
    .eq('disposition_id', dispositionId)
    .maybeSingle();
  if (!brandRow) return null;
  const m = mapFollowup(brandRow as FollowupRow);
  return m.enabled ? m : null;
}

export async function loadFollowupsForBrand(
  brandId: string,
  campaignId: string | null,
): Promise<DispositionFollowup[]> {
  const supabase = await createServerClient();
  let q = supabase.from('disposition_followups').select(SELECT).eq('brand_id', brandId);
  q = campaignId ? q.eq('campaign_id', campaignId) : q.is('campaign_id', null);
  const { data } = await q;
  return (data ?? []).map((r) => mapFollowup(r as FollowupRow));
}

// Inputs for enqueueFollowups. `overrides` lets the agent edit the body in
// the disposition dialog before sending — anything provided supersedes the
// stored template content for that one fire.
export type FollowupOverrides = {
  email?: { send: boolean; subject?: string; body?: string };
  sms?: { send: boolean; body?: string };
  task?: { create: boolean; title?: string; dueMinutes?: number };
};

type EnqueueResult = {
  email?: { id: string };
  sms?: { id: string };
  task?: { id: string };
  stageMoved?: { stageId: string };
  tagsAdded?: { tagIds: string[] };
};

// Render the resolved follow-up against the lead/brand and insert into the
// outbox + tasks. Best-effort: returns whatever it managed to enqueue.
export async function enqueueFollowups(input: {
  brandId: string;
  leadId: string;
  callId: string | null;
  campaignId: string | null;
  dispositionId: string;
  memberId: string | null;
  overrides?: FollowupOverrides;
}): Promise<EnqueueResult> {
  const tpl = await loadFollowupForDisposition(input.brandId, input.campaignId, input.dispositionId);
  if (!tpl) return {};

  // Admin client. Callers (sendDispositionFollowups) have already verified
  // the agent's access to the parent call via RLS; from there the system
  // needs to mutate lead state regardless of who owns the lead. Without
  // this the stage move + tag add silently no-op for any non-owner agent
  // because of the role-scoped RLS introduced in migration 0040.
  const supabase = createAdminClient();

  const [{ data: lead }, { data: brand }, { data: disp }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, brand_id, first_name, last_name, email, phone, do_not_call, do_not_email, stage_id, stages(name)')
      .eq('id', input.leadId)
      .maybeSingle(),
    supabase.from('brands').select('id, name').eq('id', input.brandId).maybeSingle(),
    supabase.from('dispositions').select('code').eq('id', input.dispositionId).maybeSingle(),
  ]);

  // Reject lead/brand mismatch so a forged callId can't trick the engine
  // into mutating a lead in a different brand. Belt-and-suspenders since
  // the caller resolves leadId from the call row in the first place.
  if (!lead || lead.brand_id !== input.brandId) return {};

  const stageName =
    lead.stages && typeof lead.stages === 'object' && 'name' in lead.stages
      ? ((lead.stages as { name: string | null }).name ?? null)
      : null;

  const vars = buildVars({
    lead: {
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      stage: stageName,
    },
    brand: { id: brand?.id ?? '', name: brand?.name ?? null },
    trigger: { kind: 'disposition_set', disposition: disp?.code ?? null },
  });

  const out: EnqueueResult = {};
  const ov = input.overrides ?? {};

  // Email
  const wantEmail = ov.email?.send ?? tpl.sendEmail;
  if (wantEmail && lead.email && !lead.do_not_email) {
    const subject = renderTemplate(ov.email?.subject ?? tpl.emailSubject ?? '', vars);
    const body = renderTemplate(ov.email?.body ?? tpl.emailBody ?? '', vars);
    if (subject.trim() && body.trim()) {
      const { data: row } = await supabase
        .from('message_outbox')
        .insert({
          brand_id: input.brandId,
          lead_id: input.leadId,
          channel: 'email',
          to_addr: lead.email,
          subject,
          body,
        })
        .select('id')
        .single();
      if (row) out.email = { id: row.id };
    }
  }

  // SMS
  const wantSms = ov.sms?.send ?? tpl.sendSms;
  if (wantSms && lead.phone && !lead.do_not_call) {
    const body = renderTemplate(ov.sms?.body ?? tpl.smsBody ?? '', vars);
    if (body.trim()) {
      const { data: row } = await supabase
        .from('message_outbox')
        .insert({
          brand_id: input.brandId,
          lead_id: input.leadId,
          channel: 'sms',
          to_addr: lead.phone,
          body,
        })
        .select('id')
        .single();
      if (row) out.sms = { id: row.id };
    }
  }

  // Task
  const wantTask = ov.task?.create ?? tpl.createTask;
  if (wantTask) {
    const titleRaw = ov.task?.title ?? tpl.taskTitle ?? '';
    const title = renderTemplate(titleRaw, vars).trim() || 'Follow up';
    const dueMin = ov.task?.dueMinutes ?? tpl.taskDueMinutes ?? null;
    const dueAt =
      typeof dueMin === 'number' && dueMin > 0
        ? new Date(Date.now() + dueMin * 60_000).toISOString()
        : null;
    const { data: row } = await supabase
      .from('tasks')
      .insert({
        brand_id: input.brandId,
        lead_id: input.leadId,
        assignee_id: input.memberId,
        title,
        kind: 'call',
        due_at: dueAt,
        created_by: input.memberId,
      })
      .select('id')
      .single();
    if (row) out.task = { id: row.id };
  }

  // Stage move. We re-read the lead's current stage for the audit log so
  // the timeline event captures the transition both ways. Skipped if the
  // lead is already on the target stage so we don't spam events.
  if (tpl.moveStageId && lead.stage_id !== tpl.moveStageId) {
    const { error: stageErr } = await supabase
      .from('leads')
      .update({ stage_id: tpl.moveStageId })
      .eq('id', input.leadId);
    if (!stageErr) {
      out.stageMoved = { stageId: tpl.moveStageId };
      await supabase.from('lead_events').insert({
        brand_id: input.brandId,
        lead_id: input.leadId,
        member_id: input.memberId,
        type: 'stage_change',
        payload: {
          from: lead.stage_id,
          to: tpl.moveStageId,
          via: 'disposition_followup',
          disposition: disp?.code ?? null,
        },
      });
    }
  }

  // Tag attach. on_conflict do nothing isn't exposed via PostgREST, so we
  // pre-filter to tags the lead doesn't already have. Single insert keeps
  // the round-trip count predictable when 0–N tags are configured.
  if (tpl.addTagIds.length > 0) {
    const { data: existing } = await supabase
      .from('lead_tags')
      .select('tag_id')
      .eq('lead_id', input.leadId)
      .in('tag_id', tpl.addTagIds);
    const have = new Set((existing ?? []).map((r) => r.tag_id));
    const toAdd = tpl.addTagIds.filter((id) => !have.has(id));
    if (toAdd.length > 0) {
      const { error: tagErr } = await supabase
        .from('lead_tags')
        .insert(toAdd.map((tagId) => ({ lead_id: input.leadId, tag_id: tagId })));
      if (!tagErr) {
        out.tagsAdded = { tagIds: toAdd };
        await supabase.from('lead_events').insert({
          brand_id: input.brandId,
          lead_id: input.leadId,
          member_id: input.memberId,
          type: 'tag_add',
          payload: {
            tag_ids: toAdd,
            via: 'disposition_followup',
            disposition: disp?.code ?? null,
          },
        });
      }
    }
  }

  return out;
}
