'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import {
  loadTasks,
  nextRecurrence,
  type RecurrenceRule,
  type ReminderChannel,
  type TaskKind,
  type TaskPriority,
  type TaskRow,
} from '@/lib/tasks';
import { runAutomations } from '@/lib/automation-engine';

const KINDS: TaskKind[] = ['call', 'text', 'email', 'meeting', 'note', 'other'];
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high'];
const CHANNELS: ReminderChannel[] = ['email', 'sms', 'in_app'];
const RECUR_KINDS = ['daily', 'weekly', 'monthly', 'yearly'] as const;

function bumpAll(leadId?: string | null) {
  revalidatePath('/tasks');
  revalidatePath('/dashboard');
  if (leadId) revalidatePath(`/leads/${leadId}`);
}

function isKind(v: unknown): v is TaskKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}
function isPriority(v: unknown): v is TaskPriority {
  return typeof v === 'string' && (PRIORITIES as readonly string[]).includes(v);
}
function isChannel(v: unknown): v is ReminderChannel {
  return typeof v === 'string' && (CHANNELS as readonly string[]).includes(v);
}

function normalizeRecurrence(input: unknown): RecurrenceRule | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  if (!RECUR_KINDS.includes(r.kind as (typeof RECUR_KINDS)[number])) return null;
  const every = typeof r.every === 'number' && r.every > 0 ? Math.floor(r.every) : 1;
  const endsAt = typeof r.endsAt === 'string' && r.endsAt ? r.endsAt : null;
  const count = typeof r.count === 'number' && r.count > 0 ? Math.floor(r.count) : null;
  return { kind: r.kind as RecurrenceRule['kind'], every, endsAt, count };
}

type ReminderInput = { channel: ReminderChannel; offsetMinutes: number };

function normalizeReminders(input: unknown): ReminderInput[] {
  if (!Array.isArray(input)) return [];
  const out: ReminderInput[] = [];
  for (const r of input) {
    if (!r || typeof r !== 'object') continue;
    const obj = r as Record<string, unknown>;
    if (!isChannel(obj.channel)) continue;
    if (typeof obj.offsetMinutes !== 'number' || !Number.isFinite(obj.offsetMinutes)) continue;
    out.push({ channel: obj.channel, offsetMinutes: Math.round(obj.offsetMinutes) });
  }
  return out;
}

function resolveRemindAt(dueAt: string, offsetMinutes: number): string {
  const t = new Date(dueAt).getTime() + offsetMinutes * 60 * 1000;
  return new Date(t).toISOString();
}

async function writeReminders(
  taskId: string,
  dueAt: string | null,
  reminders: ReminderInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createServerClient();
  // Replace strategy: drop existing unsent reminders for this task and reinsert.
  await supabase
    .from('task_reminders')
    .delete()
    .eq('task_id', taskId)
    .is('sent_at', null);
  if (reminders.length === 0 || !dueAt) return { ok: true };
  const rows = reminders.map((r) => ({
    task_id: taskId,
    channel: r.channel,
    offset_minutes: r.offsetMinutes,
    remind_at: resolveRemindAt(dueAt, r.offsetMinutes),
  }));
  const { error } = await supabase.from('task_reminders').insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type CreateTaskInput = {
  title: string;
  notes?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
  dueAt?: string | null;       // ISO
  leadId?: string | null;
  assigneeId?: string | null;
  recurrence?: RecurrenceRule | null;
  reminders?: ReminderInput[];
};

export async function createTask(input: CreateTaskInput) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const title = input.title.trim();
  if (!title) return { ok: false as const, error: 'Title is required' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const recurrence = normalizeRecurrence(input.recurrence);
  const reminders = normalizeReminders(input.reminders);
  const dueAt = input.dueAt ?? null;
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      brand_id: active.id,
      title,
      notes: input.notes?.trim() || null,
      kind: isKind(input.kind) ? input.kind : 'other',
      priority: isPriority(input.priority) ? input.priority : 'normal',
      due_at: dueAt,
      lead_id: input.leadId ?? null,
      assignee_id: input.assigneeId ?? null,
      recurrence,
      created_by: user.id,
    })
    .select('id, lead_id')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Insert failed' };

  const remRes = await writeReminders(data.id, dueAt, reminders);
  if (!remRes.ok) return { ok: false as const, error: remRes.error };

  bumpAll(data.lead_id);
  return { ok: true as const, id: data.id };
}

export type UpdateTaskInput = {
  title?: string;
  notes?: string | null;
  kind?: TaskKind;
  priority?: TaskPriority;
  dueAt?: string | null;
  leadId?: string | null;
  assigneeId?: string | null;
  recurrence?: RecurrenceRule | null;
  reminders?: ReminderInput[];
};

export async function updateTask(taskId: string, patch: UpdateTaskInput) {
  const supabase = await createServerClient();
  const update: {
    title?: string;
    notes?: string | null;
    kind?: TaskKind;
    priority?: TaskPriority;
    due_at?: string | null;
    lead_id?: string | null;
    assignee_id?: string | null;
    recurrence?: ReturnType<typeof normalizeRecurrence>;
  } = {};
  if (patch.title !== undefined) {
    const t = patch.title.trim();
    if (!t) return { ok: false as const, error: 'Title cannot be empty' };
    update.title = t;
  }
  if (patch.notes !== undefined) update.notes = patch.notes?.trim() || null;
  if (patch.kind !== undefined) update.kind = isKind(patch.kind) ? patch.kind : 'other';
  if (patch.priority !== undefined)
    update.priority = isPriority(patch.priority) ? patch.priority : 'normal';
  if (patch.dueAt !== undefined) update.due_at = patch.dueAt;
  if (patch.leadId !== undefined) update.lead_id = patch.leadId;
  if (patch.assigneeId !== undefined) update.assignee_id = patch.assigneeId;
  if (patch.recurrence !== undefined)
    update.recurrence = normalizeRecurrence(patch.recurrence);

  const { data, error } = await supabase
    .from('tasks')
    .update(update)
    .eq('id', taskId)
    .select('id, lead_id, due_at')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Update failed' };

  if (patch.reminders !== undefined) {
    const remRes = await writeReminders(taskId, data.due_at, normalizeReminders(patch.reminders));
    if (!remRes.ok) return { ok: false as const, error: remRes.error };
  } else if (patch.dueAt !== undefined) {
    // Re-resolve remind_at for existing unsent reminders against new due time.
    const { data: existing } = await supabase
      .from('task_reminders')
      .select('id, offset_minutes')
      .eq('task_id', taskId)
      .is('sent_at', null);
    if (existing && data.due_at) {
      for (const r of existing) {
        await supabase
          .from('task_reminders')
          .update({ remind_at: resolveRemindAt(data.due_at, r.offset_minutes) })
          .eq('id', r.id);
      }
    }
  }

  bumpAll(data.lead_id);
  return { ok: true as const };
}

export async function snoozeTask(taskId: string, untilIso: string) {
  const when = new Date(untilIso);
  if (Number.isNaN(when.getTime())) return { ok: false as const, error: 'Invalid date' };
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('tasks')
    .update({ snoozed_until: when.toISOString() })
    .eq('id', taskId)
    .select('id, lead_id')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Update failed' };
  bumpAll(data.lead_id);
  return { ok: true as const };
}

export async function completeTask(taskId: string) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const { data: existing, error: readErr } = await supabase
    .from('tasks')
    .select(
      'id, brand_id, lead_id, assignee_id, title, notes, kind, priority, due_at, recurrence, parent_task_id',
    )
    .eq('id', taskId)
    .single();
  if (readErr || !existing) return { ok: false as const, error: readErr?.message ?? 'Not found' };

  const { error: doneErr } = await supabase
    .from('tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      completed_by: user.id,
    })
    .eq('id', taskId);
  if (doneErr) return { ok: false as const, error: doneErr.message };

  // Fan out user-defined automations. Best-effort — never block the close.
  void runAutomations({
    trigger: 'task_completed',
    brandId: existing.brand_id,
    leadId: existing.lead_id,
    memberId: existing.assignee_id ?? user.id,
    taskId: existing.id,
    taskKind: existing.kind,
    taskTitle: existing.title,
  });

  // Spawn next occurrence if this task has a recurrence rule and a due_at.
  let nextId: string | null = null;
  const rule = existing.recurrence as unknown;
  const normalized =
    rule && typeof rule === 'object'
      ? normalizeRecurrence(rule)
      : null;
  if (normalized && existing.due_at) {
    const nxt = nextRecurrence(normalized, new Date(existing.due_at));
    if (nxt) {
      const { data: spawned } = await supabase
        .from('tasks')
        .insert({
          brand_id: existing.brand_id,
          lead_id: existing.lead_id,
          assignee_id: existing.assignee_id,
          title: existing.title,
          notes: existing.notes,
          kind: existing.kind,
          priority: existing.priority,
          due_at: nxt.dueAt.toISOString(),
          recurrence: nxt.nextRule,
          parent_task_id: existing.parent_task_id ?? existing.id,
          created_by: user.id,
        })
        .select('id')
        .single();
      nextId = spawned?.id ?? null;

      // Carry over reminder offsets to the spawned task.
      if (nextId) {
        const spawnedId = nextId;
        const { data: oldReminders } = await supabase
          .from('task_reminders')
          .select('channel, offset_minutes')
          .eq('task_id', taskId);
        if (oldReminders && oldReminders.length > 0) {
          await supabase.from('task_reminders').insert(
            oldReminders.map((r) => ({
              task_id: spawnedId,
              channel: r.channel,
              offset_minutes: r.offset_minutes,
              remind_at: resolveRemindAt(nxt.dueAt.toISOString(), r.offset_minutes),
            })),
          );
        }
      }
    }
  }

  bumpAll(existing.lead_id);
  return { ok: true as const, nextId };
}

export async function reopenTask(taskId: string) {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'open', completed_at: null, completed_by: null })
    .eq('id', taskId)
    .select('id, lead_id')
    .single();
  if (error || !data) return { ok: false as const, error: error?.message ?? 'Update failed' };
  bumpAll(data.lead_id);
  return { ok: true as const };
}

// Read-only convenience for clients that don't have a server-component shell
// (e.g. the lead detail drawer). RLS still scopes by brand membership.
export async function getLeadTasks(leadId: string): Promise<TaskRow[]> {
  const active = await getActiveBrand();
  if (!active) return [];
  return loadTasks(active.id, 'all', { leadId });
}

export async function getBrandTeam(): Promise<{ id: string; name: string }[]> {
  const active = await getActiveBrand();
  if (!active) return [];
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('brand_members')
    .select('members!inner(id, email, full_name)')
    .eq('brand_id', active.id);
  return (data ?? []).map((row) => ({
    id: row.members.id,
    name: row.members.full_name ?? row.members.email,
  }));
}

export async function deleteTask(taskId: string) {
  const supabase = await createServerClient();
  const { data: existing } = await supabase
    .from('tasks')
    .select('lead_id')
    .eq('id', taskId)
    .maybeSingle();
  const { error } = await supabase.from('tasks').delete().eq('id', taskId);
  if (error) return { ok: false as const, error: error.message };
  bumpAll(existing?.lead_id ?? null);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------
//
// Mirrors the pattern from /actions/leads.ts. All bulk-* task actions are
// brand-scoped via RLS plus an explicit brand_id filter. They return the
// effective row count so the UI can give meaningful feedback.
//
// Recurrence is intentionally NOT respun on bulk complete — bulk closeout
// is usually for stale items the user wants out of the way, not a
// disciplined per-task close. If they need recurrence to spawn, they
// complete the task individually.

type TasksBulkResult = { ok: true; count: number } | { ok: false; error: string };

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export async function bulkCompleteTasks(input: { ids: string[] }): Promise<TasksBulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };
  const { error, count } = await supabase
    .from('tasks')
    .update(
      {
        status: 'done',
        completed_at: new Date().toISOString(),
        completed_by: user.id,
      },
      { count: 'exact' },
    )
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  bumpAll(null);
  return { ok: true, count: count ?? 0 };
}

export async function bulkReopenTasks(input: { ids: string[] }): Promise<TasksBulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('tasks')
    .update(
      { status: 'open', completed_at: null, completed_by: null },
      { count: 'exact' },
    )
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  bumpAll(null);
  return { ok: true, count: count ?? 0 };
}

export async function bulkAssignTasks(input: {
  ids: string[];
  assigneeId: string | null;
}): Promise<TasksBulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('tasks')
    .update({ assignee_id: input.assigneeId }, { count: 'exact' })
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  bumpAll(null);
  return { ok: true, count: count ?? 0 };
}

export async function bulkDeleteTasks(input: { ids: string[] }): Promise<TasksBulkResult> {
  const active = await getActiveBrand();
  if (!active) return { ok: false, error: 'No active brand.' };
  const ids = uniqueIds(input.ids);
  if (ids.length === 0) return { ok: true, count: 0 };
  const supabase = await createServerClient();
  const { error, count } = await supabase
    .from('tasks')
    .delete({ count: 'exact' })
    .in('id', ids)
    .eq('brand_id', active.id);
  if (error) return { ok: false, error: error.message };
  bumpAll(null);
  return { ok: true, count: count ?? 0 };
}
