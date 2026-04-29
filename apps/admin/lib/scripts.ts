// Pure types + token helpers shared by server loaders, server actions, and
// client components. Do NOT import server-only modules here.

export type ScriptKind = 'call' | 'sms' | 'email';

export type ScriptRow = {
  id: string;
  brandId: string;
  kind: ScriptKind;
  name: string;
  description: string | null;
  subject: string | null; // email only
  body: string;
  updatedAt: string;
};

// Tokens supported by the renderer. Keep the list short and explicit so the
// editor can show a reference + lint unknown tokens.
export const SCRIPT_TOKENS = [
  'first_name',
  'last_name',
  'full_name',
  'phone',
  'email',
  'stage',
  'brand_name',
] as const;

export type ScriptTokenKey = (typeof SCRIPT_TOKENS)[number];

export type ScriptVars = Partial<Record<ScriptTokenKey, string | null>>;

// Replace {{token}} occurrences with values; unknown tokens are left intact so
// authors notice typos. Whitespace inside the braces is tolerated.
export function renderScript(body: string, vars: ScriptVars): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, raw) => {
    const key = String(raw).toLowerCase() as ScriptTokenKey;
    if (!(SCRIPT_TOKENS as readonly string[]).includes(key)) return match;
    const v = vars[key];
    return v == null || v === '' ? match : v;
  });
}
