import { getActiveBrand } from '@/lib/active-brand';
import { assertBrandRoleOrNotFound } from '@/lib/team';
import { loadDispositions } from '@/lib/dispositions';
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
  await assertBrandRoleOrNotFound('manager');
  const active = await getActiveBrand();
  if (!active) return null;
  const sp = await searchParams;
  const kind = parseKind(sp.kind);
  const [scripts, dispositions] = await Promise.all([
    loadScripts(active.id, { kind }),
    loadDispositions(active.id),
  ]);
  return (
    <>
      <PageHeader
        title="Scripts & Templates"
        subtitle={`${active.name} · reusable call, SMS, and email content`}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl">
          <ScriptsManager
            activeKind={kind}
            scripts={scripts}
            dispositions={dispositions.map((d) => ({ code: d.code, label: d.label }))}
          />
        </div>
      </div>
    </>
  );
}
