// Workflow definition types — graph executed by Supabase Edge Functions (wf_run, wf_tick).
// Skeleton — engine lands in Sprint 4.

export type NodeKind = 'trigger' | 'action' | 'wait' | 'condition';

export type ActionType =
  | 'send_sms'
  | 'send_email'
  | 'create_task'
  | 'move_stage'
  | 'add_tag'
  | 'remove_tag'
  | 'webhook';

export type WorkflowNode = {
  id: string;
  kind: NodeKind;
  type?: ActionType | string;
  config: Record<string, unknown>;
};

export type WorkflowEdge = {
  from: string;
  to: string;
  branch?: 'true' | 'false';
};

export type Workflow = {
  id: string;
  brandId: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  enabled: boolean;
};
