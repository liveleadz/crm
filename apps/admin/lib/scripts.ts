// Pure types + token helpers shared by server loaders, server actions, and
// client components. Do NOT import server-only modules here.

export type ScriptKind = 'call' | 'sms' | 'email';

// A "section" is one chunk of the call script with optional disposition
// jumps. Sections are an ordered list; the first one is the entry point.
// jumps[].disposition_code matches the lower-cased disposition code; on
// disposition save the dialer advances to the matching target_section_id
// for the next call. An empty target_section_id (or no match) leaves the
// next call on the entry section.
export type ScriptSectionJump = {
  disposition_code: string;
  target_section_id: string;
};

export type ScriptSection = {
  id: string;
  title: string;
  body: string;
  jumps?: ScriptSectionJump[];
};

export type ScriptRow = {
  id: string;
  brandId: string;
  kind: ScriptKind;
  name: string;
  description: string | null;
  subject: string | null; // email only
  body: string;
  // null when the script is a single text blob (legacy / non-branching).
  sections: ScriptSection[] | null;
  updatedAt: string;
};

// Returns the section id the dialer should land on for the *next* call
// after `dispositionCode` is saved on the call that just ended.
// Returns null when the script has no sections, no current section, or
// no matching jump (caller should keep the current section).
export function nextSectionForDisposition(
  sections: ScriptSection[] | null,
  currentSectionId: string | null,
  dispositionCode: string,
): string | null {
  if (!sections || sections.length === 0) return null;
  const current = sections.find((s) => s.id === currentSectionId) ?? sections[0];
  if (!current) return null;
  const code = dispositionCode.toLowerCase();
  const hit = (current.jumps ?? []).find(
    (j) => j.disposition_code.toLowerCase() === code,
  );
  return hit?.target_section_id || null;
}

// First section id (entry point) or null when no sections defined.
export function entrySectionId(sections: ScriptSection[] | null): string | null {
  if (!sections || sections.length === 0) return null;
  return sections[0]?.id ?? null;
}

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
