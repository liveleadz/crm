import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import { loadTagsForLeads, type Tag } from './tags';

export type TaskStatus = 'open' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskKind = 'call' | 'text' | 'email' | 'meeting' | 'note' | 'other';
export type ReminderChannel = 'email' | 'sms' | 'in_app';

export type RecurrenceRule = {
  kind: 'daily' | 'weekly' | 'monthly' | 'yearly';
  every: number;            // every N days/weeks/months/years
  endsAt: string | null;    // ISO date inclusive; null = no end
  count: number | null;     // remaining occurrences; null = no count limit
};

export type TaskReminder = {
  id: string;
  channel: ReminderChannel;
  remindAt: string;
  offsetMinutes: number;
  sentAt: string | null;
};

export type TaskRow = {
  id: string;
  brandId: string;
  leadId: string | null;
  leadName: string | null;
  leadPhone: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  title: string;
  notes: string | null;
  kind: TaskKind;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  snoozedUntil: string | null;
  completedAt: string | null;
  recurrence: RecurrenceRule | null;
  reminders: TaskReminder[];
  leadTags: Tag[];
  createdAt: string;
  updatedAt: string;
};

export type TaskFilter = 'today' | 'overdue' | 'upcoming' | 'done' | 'all';

// Compute the visible due time. If a task is snoozed into the future we
// effectively treat snoozed_until as the new due moment.
function effectiveDue(t: { due_at: string | null; snoozed_until: string | null }): string | null {
  if (t.snoozed_until && new Date(t.snoozed_until) > new Date()) return t.snoozed_until;
  return t.due_at;
}

type TaskSelect = {
  id: string;
  brand_id: string;
  lead_id: string | null;
  assignee_id: string | null;
  title: string;
  notes: string | null;
  kind: TaskKind;
  priority: TaskPriority;
  status: TaskStatus;
  due_at: string | null;
  snoozed_until: string | null;
  completed_at: string | null;
  recurrence: unknown;
  created_at: string;
  updated_at: string;
  leads: { first_name: string | null; last_name: string | null; phone: string | null } | null;
  assignee: { full_name: string | null; email: string } | null;
};

function rowFromDb(t: TaskSelect, reminders: TaskReminder[], leadTags: Tag[]): TaskRow {
  const r = t.recurrence;
  let rule: RecurrenceRule | null = null;
  if (r && typeof r === 'object') {
    const rec = r as Record<string, unknown>;
    const kind = rec.kind;
    if (kind === 'daily' || kind === 'weekly' || kind === 'monthly' || kind === 'yearly') {
      rule = {
        kind,
        every: typeof rec.every === 'number' && rec.every > 0 ? rec.every : 1,
        endsAt: typeof rec.endsAt === 'string' ? rec.endsAt : null,
        count:
          typeof rec.count === 'number' && rec.count > 0 ? rec.count : null,
      };
    }
  }
  const lead = t.leads;
  const leadName = lead
    ? [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || null
    : null;
  const assignee = t.assignee;
  const assigneeName = assignee?.full_name || assignee?.email || null;
  return {
    id: t.id,
    brandId: t.brand_id,
    leadId: t.lead_id,
    leadName,
    leadPhone: lead?.phone ?? null,
    assigneeId: t.assignee_id,
    assigneeName,
    title: t.title,
    notes: t.notes,
    kind: t.kind,
    priority: t.priority,
    status: t.status,
    dueAt: effectiveDue(t),
    snoozedUntil: t.snoozed_until,
    completedAt: t.completed_at,
    recurrence: rule,
    reminders,
    leadTags,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

const TASK_SELECT = `
  id, brand_id, lead_id, assignee_id, title, notes, kind, priority, status,
  due_at, snoozed_until, completed_at, recurrence, created_at, updated_at,
  leads:lead_id ( first_name, last_name, phone ),
  assignee:assignee_id ( full_name, email )
`;

async function fetchReminders(taskIds: string[]): Promise<Map<string, TaskReminder[]>> {
  const map = new Map<string, TaskReminder[]>();
  if (taskIds.length === 0) return map;
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('task_reminders')
    .select('id, task_id, channel, remind_at, offset_minutes, sent_at')
    .in('task_id', taskIds);
  for (const r of data ?? []) {
    const list = map.get(r.task_id) ?? [];
    list.push({
      id: r.id,
      channel: r.channel as ReminderChannel,
      remindAt: r.remind_at,
      offsetMinutes: r.offset_minutes,
      sentAt: r.sent_at,
    });
    map.set(r.task_id, list);
  }
  return map;
}

export async function loadTasks(
  brandId: string,
  filter: TaskFilter,
  opts?: { leadId?: string | null; assigneeId?: string | null },
): Promise<TaskRow[]> {
  const supabase = await createServerClient();
  let query = supabase
    .from('tasks')
    .select(TASK_SELECT)
    .eq('brand_id', brandId);

  if (opts?.leadId !== undefined) {
    if (opts.leadId === null) query = query.is('lead_id', null);
    else query = query.eq('lead_id', opts.leadId);
  }
  if (opts?.assigneeId) query = query.eq('assignee_id', opts.assigneeId);

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  if (filter === 'today') {
    query = query
      .eq('status', 'open')
      .lt('due_at', endOfDay.toISOString())
      .gte('due_at', startOfDay.toISOString());
    query = query.order('due_at', { ascending: true });
  } else if (filter === 'overdue') {
    query = query.eq('status', 'open').lt('due_at', startOfDay.toISOString());
    query = query.order('due_at', { ascending: true });
  } else if (filter === 'upcoming') {
    query = query.eq('status', 'open').gte('due_at', endOfDay.toISOString());
    query = query.order('due_at', { ascending: true });
  } else if (filter === 'done') {
    query = query.eq('status', 'done').order('completed_at', { ascending: false }).limit(100);
  } else {
    query = query.order('due_at', { ascending: true, nullsFirst: false });
  }

  const { data, error } = await query;
  if (error || !data) return [];
  const rows = data as unknown as TaskSelect[];
  const reminders = await fetchReminders(rows.map((r) => r.id));
  const leadIds = rows
    .map((r) => r.lead_id)
    .filter((id): id is string => id !== null);
  const tagsByLead = await loadTagsForLeads(leadIds);
  return rows.map((t) =>
    rowFromDb(
      t,
      reminders.get(t.id) ?? [],
      t.lead_id ? tagsByLead.get(t.lead_id) ?? [] : [],
    ),
  );
}

export async function loadTaskCounts(brandId: string): Promise<{
  today: number;
  overdue: number;
  upcoming: number;
}> {
  const supabase = await createServerClient();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  const [todayRes, overdueRes, upcomingRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'open')
      .gte('due_at', startOfDay.toISOString())
      .lt('due_at', endOfDay.toISOString()),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'open')
      .lt('due_at', startOfDay.toISOString()),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('brand_id', brandId)
      .eq('status', 'open')
      .gte('due_at', endOfDay.toISOString()),
  ]);
  return {
    today: todayRes.count ?? 0,
    overdue: overdueRes.count ?? 0,
    upcoming: upcomingRes.count ?? 0,
  };
}

// Compute the next occurrence for a recurring task, given the due time of the
// completed instance. Returns null when the rule has terminated.
export function nextRecurrence(
  rule: RecurrenceRule,
  fromDue: Date,
): { dueAt: Date; nextRule: RecurrenceRule } | null {
  const next = new Date(fromDue);
  switch (rule.kind) {
    case 'daily':
      next.setDate(next.getDate() + rule.every);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7 * rule.every);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + rule.every);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + rule.every);
      break;
  }
  if (rule.endsAt && next > new Date(rule.endsAt)) return null;
  let count = rule.count;
  if (count != null) {
    count -= 1;
    if (count <= 0) return null;
  }
  return { dueAt: next, nextRule: { ...rule, count } };
}
