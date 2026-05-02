import { getActiveBrand } from '@/lib/active-brand';
import { loadKanban } from '@/lib/leads';
import { loadBrandTagsWithCounts } from '@/lib/tags';
import { loadDispositions } from '@/lib/dispositions';
import { loadFollowupsForBrand } from '@/lib/disposition-followups';
import { createServerClient } from '@leadpilot/db/server';
import { PageHeader } from '@/components/page-header';
import { StagesManager } from '@/components/settings/stages-manager';
import { TagsManager } from '@/components/settings/tags-manager';
import { DispositionsManager } from '@/components/settings/dispositions-manager';
import { BrandFollowupsManager } from '@/components/settings/brand-followups-manager';
import { BrandDialPolicy } from '@/components/settings/brand-dial-policy';

export default async function SettingsPage() {
  const active = await getActiveBrand();
  if (!active) return null;
  const supabase = await createServerClient();
  const [{ stages }, tags, dispositions, brandFollowups, { data: brandRow }] = await Promise.all([
    loadKanban(active.id),
    loadBrandTagsWithCounts(active.id),
    loadDispositions(active.id),
    loadFollowupsForBrand(active.id, null),
    supabase
      .from('brands')
      .select('max_dials_per_lead_per_day')
      .eq('id', active.id)
      .maybeSingle(),
  ]);
  const dialCap = brandRow?.max_dials_per_lead_per_day ?? null;
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={`${active.name} · pipeline configuration`}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-8">
          <section>
            <h2 className="mb-1 text-[13px] font-semibold">Pipeline stages</h2>
            <p className="mb-4 text-[12px] text-txt-3">
              Stages are brand-scoped and shown left-to-right on the leads kanban. Mark a
              stage as Won or Lost to drive reporting.
            </p>
            <StagesManager initialStages={stages} />
          </section>
          <section>
            <h2 className="mb-1 text-[13px] font-semibold">Tags</h2>
            <p className="mb-4 text-[12px] text-txt-3">
              Tags categorize leads across pipelines. Rename or recolor any tag here, or
              delete one to detach it from every lead.
            </p>
            <TagsManager initialTags={tags} />
          </section>
          <section>
            <h2 className="mb-1 text-[13px] font-semibold">Dial policy</h2>
            <p className="mb-4 text-[12px] text-txt-3">
              Brand-wide guardrails that apply on top of campaign-specific
              recently-called dedupe. Caps the number of times we hit the
              same lead in a 24h window. Pair with per-disposition cooldowns
              below to throttle voicemails and no-answers.
            </p>
            <BrandDialPolicy initialCap={dialCap} />
          </section>
          <section>
            <h2 className="mb-1 text-[13px] font-semibold">Call dispositions</h2>
            <p className="mb-4 text-[12px] text-txt-3">
              Outcomes agents pick after every call. Reorder, retone, rename, or
              archive — archived ones still resolve on historical calls.
              Cooldown suppresses redial of the lead for N minutes after a
              call resolves with that disposition.
            </p>
            <DispositionsManager initial={dispositions} />
          </section>
          <section>
            <h2 className="mb-1 text-[13px] font-semibold">Default disposition follow-ups</h2>
            <p className="mb-4 text-[12px] text-txt-3">
              When an agent saves a disposition, fire an email, SMS, or task
              automatically. Configured here brand-wide. Campaigns can override
              individual rows from their own Follow-ups tab.
            </p>
            <BrandFollowupsManager
              dispositions={dispositions.map((d) => ({
                id: d.id,
                code: d.code,
                label: d.label,
                tone: d.tone,
              }))}
              followups={brandFollowups}
              stages={stages.map((s) => ({ id: s.id, name: s.name }))}
              tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
            />
          </section>
        </div>
      </div>
    </>
  );
}
