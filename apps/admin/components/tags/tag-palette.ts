// Static palette lookup. Keys must match values stored in tags.color.
// We hand-write full classnames so Tailwind's JIT can statically detect them.

export const TAG_COLORS = [
  'teal',
  'blue',
  'amber',
  'rose',
  'purple',
  'green',
  'orange',
  'pink',
  'slate',
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export const TAG_COLOR_CLASS: Record<TagColor, string> = {
  teal: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800/50',
  blue: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800/50',
  amber:
    'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800/50',
  rose: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800/50',
  purple:
    'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800/50',
  green:
    'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800/50',
  orange:
    'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-800/50',
  pink: 'bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:border-pink-800/50',
  slate:
    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/60',
};

export function tagColorClass(color: string | null | undefined): string {
  if (color && (TAG_COLORS as readonly string[]).includes(color)) {
    return TAG_COLOR_CLASS[color as TagColor];
  }
  return TAG_COLOR_CLASS.slate;
}
