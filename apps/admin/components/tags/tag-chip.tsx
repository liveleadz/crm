import { tagColorClass } from './tag-palette';

export function TagChip({
  name,
  color,
  size = 'sm',
  onRemove,
}: {
  name: string;
  color?: string | null;
  size?: 'xs' | 'sm';
  onRemove?: () => void;
}) {
  const sizeCls = size === 'xs' ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border ${sizeCls} font-medium ${tagColorClass(color)}`}
    >
      <span className="truncate max-w-[140px]">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="grid h-3 w-3 place-items-center rounded-full opacity-70 hover:opacity-100"
          aria-label={`Remove ${name}`}
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}
