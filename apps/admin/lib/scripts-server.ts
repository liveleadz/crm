import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import type { ScriptKind, ScriptRow, ScriptSection } from './scripts';

function parseSections(raw: unknown): ScriptSection[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ScriptSection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id) continue;
    if (typeof r.title !== 'string') continue;
    if (typeof r.body !== 'string') continue;
    const jumps = Array.isArray(r.jumps)
      ? r.jumps.flatMap((j) => {
          if (!j || typeof j !== 'object') return [];
          const jr = j as Record<string, unknown>;
          if (
            typeof jr.disposition_code !== 'string' ||
            typeof jr.target_section_id !== 'string'
          )
            return [];
          return [
            {
              disposition_code: jr.disposition_code,
              target_section_id: jr.target_section_id,
            },
          ];
        })
      : [];
    out.push({ id: r.id, title: r.title, body: r.body, jumps });
  }
  return out.length > 0 ? out : null;
}

function rowFromDb(r: {
  id: string;
  brand_id: string;
  kind: string;
  name: string;
  description: string | null;
  subject: string | null;
  body: string;
  sections: unknown;
  updated_at: string;
}): ScriptRow {
  const kind: ScriptKind =
    r.kind === 'sms' || r.kind === 'email' ? r.kind : 'call';
  return {
    id: r.id,
    brandId: r.brand_id,
    kind,
    name: r.name,
    description: r.description,
    subject: r.subject,
    body: r.body,
    sections: parseSections(r.sections),
    updatedAt: r.updated_at,
  };
}

export async function loadScripts(
  brandId: string,
  opts?: { kind?: ScriptKind | null },
): Promise<ScriptRow[]> {
  const supabase = await createServerClient();
  let q = supabase
    .from('scripts')
    .select('id, brand_id, kind, name, description, subject, body, sections, updated_at')
    .eq('brand_id', brandId)
    .order('updated_at', { ascending: false });
  if (opts?.kind) q = q.eq('kind', opts.kind);
  const { data } = await q;
  return (data ?? []).map(rowFromDb);
}

export async function loadScript(
  scriptId: string,
  brandId: string,
): Promise<ScriptRow | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('scripts')
    .select('id, brand_id, kind, name, description, subject, body, sections, updated_at')
    .eq('id', scriptId)
    .eq('brand_id', brandId)
    .maybeSingle();
  return data ? rowFromDb(data) : null;
}
