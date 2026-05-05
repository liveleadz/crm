// Shared (server + client) disposition types and constants.
//
// Lives separately from `lib/dispositions.ts` because that module is
// `'server-only'` (it imports the Supabase server client) and the
// settings UI is a client component that needs the category constants
// for its category dropdown.

export type DispositionTone = 'good' | 'neutral' | 'bad';

// Fixed-vocabulary metric category. The brand's `code` and `label` are
// brand-configurable, so reports cannot read them directly — a brand
// could rename "Connected" to "Closed" and the connect rate would
// silently drop to zero. `category` is the stable axis the reports
// layer aggregates against.
export type DispositionCategory =
  | 'wrong_number'
  | 'no_answer'
  | 'voicemail'
  | 'connected'
  | 'appointment_set'
  | 'callback'
  | 'do_not_call'
  | 'not_interested'
  | 'other';

export const DISPOSITION_CATEGORIES: DispositionCategory[] = [
  'connected',
  'appointment_set',
  'callback',
  'voicemail',
  'no_answer',
  'wrong_number',
  'not_interested',
  'do_not_call',
  'other',
];

export const DISPOSITION_CATEGORY_LABELS: Record<DispositionCategory, string> = {
  connected: 'Connected',
  appointment_set: 'Appointment set',
  callback: 'Callback',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
  do_not_call: 'Do not call',
  other: 'Other',
};

// Categories that count as a "connect" for the connect-rate KPI.
export const CONNECTED_CATEGORIES: ReadonlySet<DispositionCategory> = new Set<DispositionCategory>([
  'connected',
  'appointment_set',
  'callback',
  'not_interested',
]);

export type Disposition = {
  id: string;
  code: string;
  label: string;
  tone: DispositionTone;
  category: DispositionCategory;
  sortOrder: number;
  // After a call resolves with this disposition, suppress this lead from
  // queue / manual dial for N minutes. NULL/0 = no cooldown.
  cooldownMinutes: number | null;
};

export function normalizeDispositionCategory(raw: unknown): DispositionCategory {
  if (typeof raw !== 'string') return 'other';
  return (DISPOSITION_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as DispositionCategory)
    : 'other';
}
