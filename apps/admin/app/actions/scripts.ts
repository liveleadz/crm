'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';
import { loadScripts } from '@/lib/scripts-server';
import type { ScriptKind, ScriptRow, ScriptSection } from '@/lib/scripts';

// Defensive narrow before persisting sections JSONB. Drops anything that
// doesn't match the expected shape so a malformed client payload can't
// poison the row (the dialer reader trusts the shape).
function sanitizeSections(input: unknown): ScriptSection[] | null {
  if (input === null) return null;
  if (!Array.isArray(input)) return null;
  const out: ScriptSection[] = [];
  const seenIds = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const body = typeof r.body === 'string' ? r.body : '';
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const jumpsRaw = Array.isArray(r.jumps) ? r.jumps : [];
    const jumps = jumpsRaw
      .map((j) => {
        if (!j || typeof j !== 'object') return null;
        const jj = j as Record<string, unknown>;
        const dc = typeof jj.disposition_code === 'string' ? jj.disposition_code.trim() : '';
        const tg = typeof jj.target_section_id === 'string' ? jj.target_section_id.trim() : '';
        if (!dc || !tg) return null;
        return { disposition_code: dc, target_section_id: tg };
      })
      .filter((x): x is { disposition_code: string; target_section_id: string } => !!x);
    out.push({ id, title: title || 'Untitled', body, jumps });
  }
  return out.length === 0 ? null : out;
}

function bump() {
  revalidatePath('/scripts');
  revalidatePath('/leads');
}

// Lead-drawer picker fetches the brand's scripts together with the brand name
// so {{brand_name}} renders without forcing parents to thread it down.
export async function getBrandScripts(
  kind?: ScriptKind,
): Promise<{ scripts: ScriptRow[]; brandName: string | null }> {
  const active = await getActiveBrand();
  if (!active) return { scripts: [], brandName: null };
  const scripts = await loadScripts(active.id, kind ? { kind } : undefined);
  return { scripts, brandName: active.name };
}

export async function createScript(input: {
  kind: ScriptKind;
  name: string;
  description?: string | null;
  subject?: string | null;
  body?: string;
}) {
  const active = await getActiveBrand();
  if (!active) return { ok: false as const, error: 'No active brand' };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: 'Name is required' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('scripts')
    .insert({
      brand_id: active.id,
      kind: input.kind,
      name,
      description: input.description?.trim() || null,
      subject: input.kind === 'email' ? input.subject?.trim() || null : null,
      body: input.body ?? '',
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false as const, error: error?.message ?? 'Insert failed' };
  }
  bump();
  return { ok: true as const, id: data.id };
}

export async function updateScript(
  scriptId: string,
  patch: {
    name?: string;
    description?: string | null;
    subject?: string | null;
    body?: string;
    sections?: ScriptSection[] | null;
  },
) {
  const supabase = await createServerClient();
  const update: {
    name?: string;
    description?: string | null;
    subject?: string | null;
    body?: string;
    sections?: ScriptSection[] | null;
  } = {};
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) return { ok: false as const, error: 'Name is required' };
    update.name = n;
  }
  if (patch.description !== undefined) {
    update.description = patch.description?.trim() || null;
  }
  if (patch.subject !== undefined) {
    update.subject = patch.subject?.trim() || null;
  }
  if (patch.body !== undefined) update.body = patch.body;
  if (patch.sections !== undefined) update.sections = sanitizeSections(patch.sections);

  const { error } = await supabase.from('scripts').update(update).eq('id', scriptId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}

export async function deleteScript(scriptId: string) {
  const supabase = await createServerClient();
  const { error } = await supabase.from('scripts').delete().eq('id', scriptId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}
