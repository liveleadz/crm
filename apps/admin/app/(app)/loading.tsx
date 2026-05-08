// Route-group loading boundary. Without this Next.js blocks the whole
// navigation until the new page's server component finishes rendering,
// which is what made sidebar clicks feel "stuck for a few seconds".
// With it, the URL + sidebar active highlight (which read from
// usePathname()) update instantly while the page streams in behind a
// Suspense boundary. The fallback intentionally mirrors the in-page
// header bar so the transition is visually quiet — no layout shift,
// no spinner overlay.

export default function Loading() {
  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-surface px-6 py-4">
        <div>
          <div className="h-[15px] w-32 animate-pulse rounded bg-surface-2" />
          <div className="mt-1.5 h-[12px] w-48 animate-pulse rounded bg-surface-2" />
        </div>
      </div>
      <div className="flex-1" />
    </>
  );
}
