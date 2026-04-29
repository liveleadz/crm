import { getActiveBrand } from '@/lib/active-brand';
import { loadScripts } from '@/lib/scripts-server';
import type { ScriptKind } from '@/lib/scripts';
import { PageHeader } from '@/components/page-header';
import { ScriptsManager } from '@/components/scripts/scripts-manager';

const VALID_KINDS: ScriptKind[] = ['call', 'sms', 'email'];

function parseKind(v: string | string[] | undefined): ScriptKind {
  const s = Array.isArray(v) ? v[0] : v;
  return VALID_KINDS.find((k) => k === s) ?? 'call';
}

export default async function ScriptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const active = await getActiveBrand();
  if (!active) return null;
  const sp = await searchParams;
  const kind = parseKind(sp.kind);
  const scripts = await loadScripts(active.id, { kind });
  return (
    <>
      <PageHeader
        title="Scripts & Templates"
        subtitle={`${active.name} · reusable call, SMS, and email content`}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <ScriptsManager activeKind={kind} scripts={scripts} />
        </div>
      </div>
    </>
  );
}
