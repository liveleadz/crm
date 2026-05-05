// Phase O: tiny animated pulse dot. Reused on the sidebar entry, agent
// tile statuses, and active-call cards.

export function LivePulseDot({
  active,
  className = '',
}: {
  active: boolean;
  className?: string;
}) {
  if (!active) {
    return <span className={`inline-block h-2 w-2 rounded-full bg-txt-3/50 ${className}`} />;
  }
  return (
    <span className={`relative inline-flex h-2 w-2 ${className}`}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hp/60 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-hp" />
    </span>
  );
}
