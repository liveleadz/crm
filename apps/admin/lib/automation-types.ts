// Pure types + helpers safe for client components. Kept out of the
// server-only loader file so client UI can import describeAction without
// pulling the Supabase server client into the browser bundle.

export type AutomationAction =
  | { kind: 'move_stage'; stage_id: string }
  | { kind: 'mark_dnc' }
  | { kind: 'add_tag'; tag_id: string }
  | {
      kind: 'create_task';
      title: string;
      task_kind?: 'call' | 'text' | 'email' | 'meeting' | 'note' | 'other';
      due_in_minutes?: number;
      use_callback_at?: boolean;
      assign_to_caller?: boolean;
    };

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
};

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
    default:
      return 'Unknown action';
  }
}
