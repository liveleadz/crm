import 'server-only';
import { createServerClient } from '@leadpilot/db/server';
import type { ScriptKind, ScriptRow } from './scripts';

function rowFromDb(r: {
  id: string;
  brand_id: string;
  kind: string;
  name: string;
  description: string | null;
  subject: string | null;
  body: string;
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
    .select('id, brand_id, kind, name, description, subject, body, updated_at')
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
    .select('id, brand_id, kind, name, description, subject, body, updated_at')
    .eq('id', scriptId)
    .eq('brand_id', brandId)
    .maybeSingle();
  return data ? rowFromDb(data) : null;
}
