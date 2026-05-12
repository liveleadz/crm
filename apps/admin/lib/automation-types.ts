// Pure types + helpers safe for client components. Kept out of the
// server-only loader file so client UI can import describeAction without
// pulling the Supabase server client into the browser bundle.

export type MemberRole = 'owner' | 'admin' | 'manager' | 'agent' | 'viewer';

export type LeadFieldKey =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'phone'
  | 'notes'
  | `custom.${string}`;

export type HttpMethod = 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE';

export type AutomationAction =
  | { kind: 'move_stage'; stage_id: string }
  // Drops the lead off the kanban without deleting it. Used by the
  // Wrong Number / DNC system automations so a bad-number or
  // do-not-call lead no longer occupies a pipeline column. The lead
  // row + history are preserved; only stage_id is cleared.
  | { kind: 'clear_stage' }
  | { kind: 'mark_dnc' }
  | { kind: 'add_tag'; tag_id: string }
  | {
      kind: 'create_task';
      title: string;
      task_kind?: 'call' | 'text' | 'email' | 'meeting' | 'note' | 'other';
      due_in_minutes?: number;
      use_callback_at?: boolean;
      assign_to_caller?: boolean;
      // When true, drop a single in-app task_reminder firing at due_at.
      // Used by the seeded Callback automation so the agent gets a
      // notification at the requested callback time.
      with_reminder?: boolean;
    }
  | {
      kind: 'send_email';
      to: 'lead' | 'literal';
      literal_to?: string;
      subject: string;
      body: string;
    }
  | {
      kind: 'send_sms';
      to: 'lead' | 'literal';
      literal_to?: string;
      body: string;
    }
  | {
      kind: 'send_notification';
      recipient_kind: 'caller' | 'lead_owner' | 'role' | 'member';
      role?: MemberRole;
      member_id?: string;
      title: string;
      body?: string;
      link_url?: string;
    }
  | {
      kind: 'http_request';
      method: HttpMethod;
      url: string;
      headers?: Array<{ key: string; value: string }>;
      body_template?: string;
    }
  | {
      kind: 'update_lead_field';
      field: LeadFieldKey;
      value: string;
    }
  | {
      kind: 'create_contact';
      first_name?: string;
      last_name?: string;
      email?: string;
      phone?: string;
      city?: string;
      state?: string;
      zip?: string;
      notes?: string;
      stage_id?: string;
      // When true, ctx.leadId is set to the new contact so downstream
      // lead-bound actions (send_email, move_stage, etc.) target it.
      set_as_run_lead?: boolean;
    };

export type AutomationMode = 'simple' | 'graph';

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actions: AutomationAction[];
  isEnabled: boolean;
  isSystem: boolean;
  sortOrder: number;
  mode: AutomationMode;
  graph: WorkflowGraph | null;
  webhookToken: string | null;
};

export type WaitMode = 'fixed_minutes' | 'until_callback_time' | 'until_datetime' | 'business_days';

export type WaitNodeData =
  | { mode?: 'fixed_minutes'; duration_minutes: number }
  | { mode: 'until_callback_time' }
  | { mode: 'until_datetime'; iso_at: string }
  | { mode: 'business_days'; days: number };

// ---------------------------------------------------------------------------
// Graph (canvas-mode) types
// ---------------------------------------------------------------------------
//
// A graph is a DAG starting at a single trigger node. Edges may carry a
// sourceHandle when leaving a branch node, which selects the labelled output
// (yes / no / none).
//
// Action nodes reuse the same AutomationAction shape used by simple mode so
// existing executors are shared. Wait nodes are first-class (not actions)
// because they suspend execution by writing to workflow_runs.next_run_at.

export type Position = { x: number; y: number };

export type BranchCondition =
  | { kind: 'lead_has_tag'; tag_id: string }
  | { kind: 'lead_in_stage'; stage_id: string }
  | { kind: 'lead_field_equals'; field: 'do_not_call'; value: boolean }
  | { kind: 'disposition_equals'; codes: string[] };

export type GraphNode =
  | {
      id: string;
      type: 'trigger';
      position: Position;
      data: { trigger_type: string; trigger_config: Record<string, unknown> };
    }
  | {
      id: string;
      type: 'action';
      position: Position;
      data: { action: AutomationAction };
    }
  | {
      id: string;
      type: 'branch';
      position: Position;
      data: { condition: BranchCondition };
    }
  | {
      id: string;
      type: 'wait';
      position: Position;
      data: WaitNodeData;
    }
  | {
      id: string;
      type: 'end';
      position: Position;
      data: Record<string, never>;
    };

export type BranchHandle = 'yes' | 'no' | 'none';

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: BranchHandle;
};

export type WorkflowGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

// Build a minimal graph from a simple-mode automation so the visual editor
// has something to render the first time a user toggles a rule. Lays out
// nodes in a straight vertical column with 140px spacing.
export function graphFromSimple(input: {
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  actions: AutomationAction[];
}): WorkflowGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const x = 320;
  let y = 80;
  const triggerId = 'trigger';
  nodes.push({
    id: triggerId,
    type: 'trigger',
    position: { x, y },
    data: { trigger_type: input.triggerType, trigger_config: input.triggerConfig },
  });
  let prev = triggerId;
  for (let i = 0; i < input.actions.length; i++) {
    y += 140;
    const id = `a${i + 1}`;
    nodes.push({
      id,
      type: 'action',
      position: { x, y },
      data: { action: input.actions[i]! },
    });
    edges.push({ id: `${prev}->${id}`, source: prev, target: id });
    prev = id;
  }
  return { nodes, edges };
}

// Best-effort linearization of a graph back into a simple actions[] for
// readouts (list view summary, sorting). Walks the trigger's first
// downstream chain and stops on any branch / wait.
export function linearizeGraph(graph: WorkflowGraph): AutomationAction[] {
  if (!graph.nodes.length) return [];
  const trigger = graph.nodes.find((n) => n.type === 'trigger');
  if (!trigger) return [];
  const out: AutomationAction[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e);
    outgoing.set(e.source, list);
  }
  let cursor: string | undefined = trigger.id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const next = outgoing.get(cursor)?.[0];
    if (!next) break;
    const node = byId.get(next.target);
    if (!node) break;
    if (node.type === 'action') {
      out.push(node.data.action);
      cursor = node.id;
    } else {
      // Branches and waits can't be flattened — stop the readout here.
      break;
    }
  }
  return out;
}

export function describeAction(
  action: AutomationAction,
  ctx: { stages: { id: string; name: string }[]; tags: { id: string; name: string }[] },
): string {
  switch (action.kind) {
    case 'move_stage': {
      const s = ctx.stages.find((x) => x.id === action.stage_id);
      return `Move lead to ${s?.name ?? 'stage'}`;
    }
    case 'mark_dnc':
      return 'Mark lead as Do Not Call';
    case 'add_tag': {
      const t = ctx.tags.find((x) => x.id === action.tag_id);
      return `Add tag ${t?.name ?? 'tag'}`;
    }
    case 'create_task': {
      const when = action.use_callback_at
        ? 'at callback time'
        : action.due_in_minutes
          ? `in ${action.due_in_minutes} min`
          : 'no due date';
      return `Create task "${action.title}" (${when})`;
    }
    case 'send_email': {
      const to = action.to === 'lead' ? 'lead email' : action.literal_to || 'recipient';
      return `Send email to ${to}${action.subject ? ` — "${action.subject}"` : ''}`;
    }
    case 'send_sms': {
      const to = action.to === 'lead' ? 'lead phone' : action.literal_to || 'recipient';
      return `Send SMS to ${to}`;
    }
    case 'send_notification': {
      const who =
        action.recipient_kind === 'caller'
          ? 'caller'
          : action.recipient_kind === 'lead_owner'
            ? 'lead owner'
            : action.recipient_kind === 'role'
              ? `${action.role ?? 'role'}s`
              : 'member';
      return `Notify ${who}: "${action.title}"`;
    }
    case 'http_request': {
      return `${action.method} ${action.url || '(no URL)'}`;
    }
    case 'update_lead_field': {
      return `Set lead.${action.field} = ${truncate(action.value, 28)}`;
    }
    case 'create_contact': {
      const name = [action.first_name, action.last_name].filter(Boolean).join(' ').trim();
      const ident = name || action.email || action.phone || 'new contact';
      return `Create contact ${truncate(ident, 28)}${action.set_as_run_lead ? ' (use as run lead)' : ''}`;
    }
    default:
      return 'Unknown action';
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '\u2026';
}

export function describeWait(data: WaitNodeData): string {
  const mode: WaitMode = (data as { mode?: WaitMode }).mode ?? 'fixed_minutes';
  switch (mode) {
    case 'fixed_minutes': {
      const minutes = (data as { duration_minutes: number }).duration_minutes ?? 0;
      if (!minutes) return 'No delay';
      if (minutes < 60) return `${minutes} min`;
      const h = Math.floor(minutes / 60);
      const m = minutes % 60;
      if (m === 0) return `${h} hr`;
      return `${h}h ${m}m`;
    }
    case 'until_callback_time':
      return 'Until callback time';
    case 'until_datetime': {
      const iso = (data as { iso_at: string }).iso_at;
      if (!iso) return 'Until specific time';
      try {
        const d = new Date(iso);
        return `Until ${d.toLocaleString()}`;
      } catch {
        return 'Until specific time';
      }
    }
    case 'business_days': {
      const days = (data as { days: number }).days ?? 1;
      return `${days} business day${days === 1 ? '' : 's'}`;
    }
    default:
      return 'Wait';
  }
}

export function describeTrigger(
  triggerType: string,
  config: Record<string, unknown>,
  dispositions: { code: string; label: string }[],
): string {
  if (triggerType === 'disposition_set') {
    const codes = Array.isArray(config.codes) ? (config.codes as string[]) : [];
    if (codes.length === 0) return 'Click to choose a trigger';
    const labels = codes.map((c) => dispositions.find((d) => d.code === c)?.label ?? c);
    return `When disposition is ${labels.join(', ')}`;
  }
  if (triggerType === 'webhook_received') {
    return 'When webhook is received';
  }
  if (triggerType === 'call_received') {
    return 'When inbound call is received';
  }
  if (triggerType === 'lead_created') {
    const sources = Array.isArray(config.source_in) ? (config.source_in as string[]) : [];
    if (sources.length === 0) return 'When a lead is created';
    return `When a lead is created from ${sources.join(', ')}`;
  }
  if (triggerType === 'stage_changed') {
    const to = Array.isArray(config.to_stage_in) ? (config.to_stage_in as string[]) : [];
    if (to.length === 0) return 'When a lead\u2019s stage changes';
    return `When a lead moves into ${to.length} stage${to.length === 1 ? '' : 's'}`;
  }
  if (triggerType === 'email_received') {
    return 'When an email is received from a lead';
  }
  if (triggerType === 'appointment_booked') {
    return 'When an appointment is booked';
  }
  if (triggerType === 'task_completed') {
    const kinds = Array.isArray(config.task_kind_in) ? (config.task_kind_in as string[]) : [];
    if (kinds.length === 0) return 'When a task is completed';
    return `When a ${kinds.join('/')} task is completed`;
  }
  if (triggerType === 'call_ended') {
    const dirs = Array.isArray(config.direction_in) ? (config.direction_in as string[]) : [];
    if (dirs.length === 0) return 'When a call ends';
    return `When an ${dirs.join('/')} call ends`;
  }
  if (triggerType === 'tag_added') {
    const tags = Array.isArray(config.tag_in) ? (config.tag_in as string[]) : [];
    if (tags.length === 0) return 'When a tag is added to a lead';
    return `When ${tags.length} specific tag${tags.length === 1 ? '' : 's'} added to a lead`;
  }
  return 'Click to choose a trigger';
}

export function describeBranch(
  cond: BranchCondition,
  ctx: {
    stages: { id: string; name: string }[];
    tags: { id: string; name: string }[];
    dispositions: { code: string; label: string }[];
  },
): string {
  switch (cond.kind) {
    case 'lead_has_tag': {
      const t = ctx.tags.find((x) => x.id === cond.tag_id);
      return `Lead has tag "${t?.name ?? 'tag'}"`;
    }
    case 'lead_in_stage': {
      const s = ctx.stages.find((x) => x.id === cond.stage_id);
      return `Lead is in stage "${s?.name ?? 'stage'}"`;
    }
    case 'lead_field_equals':
      return `Lead.${cond.field} is ${cond.value}`;
    case 'disposition_equals': {
      const labels = cond.codes
        .map((c) => ctx.dispositions.find((d) => d.code === c)?.label ?? c)
        .join(', ');
      return `Disposition is ${labels || '(none)'}`;
    }
    default:
      return 'Unknown condition';
  }
}
