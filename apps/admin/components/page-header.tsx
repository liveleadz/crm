export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-line bg-surface px-6 py-4">
      <div>
        <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-txt-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StubBody({ note }: { note: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-12">
      <div className="max-w-md rounded-lg border border-dashed border-line-2 bg-surface p-8 text-center">
        <p className="text-[12.5px] text-txt-3">{note}</p>
      </div>
    </div>
  );
}
