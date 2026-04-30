// Template variable resolution for automation actions. Wraps the existing
// SCRIPT_TOKENS pattern from /lib/scripts.ts but supports nested dot paths
// like "lead.first_name", "trigger.disposition", "webhook.body.foo.bar".
//
// Whitespace inside the braces is tolerated. Unknown paths render as the
// original placeholder text so authors notice typos.

export type TemplateVars = Record<string, unknown>;

export type LeadVars = {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  stage?: string | null;
};

export type TriggerVars = {
  kind?: string;
  disposition?: string | null;
  callback_at?: string | null;
};

export type BrandVars = {
  id?: string;
  name?: string | null;
};

/**
 * Build a flat-namespaced bag of template variables. Nested objects are
 * preserved so the resolver can walk dot paths.
 */
export function buildVars(input: {
  lead: LeadVars;
  brand: BrandVars;
  trigger: TriggerVars;
  webhook?: { body?: unknown; headers?: Record<string, string> };
}): TemplateVars {
  return {
    lead: {
      first_name: input.lead.first_name ?? '',
      last_name: input.lead.last_name ?? '',
      full_name:
        input.lead.full_name ??
        [input.lead.first_name, input.lead.last_name].filter(Boolean).join(' ').trim(),
      email: input.lead.email ?? '',
      phone: input.lead.phone ?? '',
      stage: input.lead.stage ?? '',
    },
    brand: {
      id: input.brand.id ?? '',
      name: input.brand.name ?? '',
    },
    trigger: {
      kind: input.trigger.kind ?? '',
      disposition: input.trigger.disposition ?? '',
      callback_at: input.trigger.callback_at ?? '',
    },
    webhook: input.webhook ?? {},
  };
}

/**
 * Render `{{ path.to.value }}` placeholders against the variable bag. Unknown
 * paths or null/empty values fall back to the original placeholder so authors
 * can spot typos at a glance.
 */
export function renderTemplate(input: string, vars: TemplateVars): string {
  if (!input) return '';
  return input.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, raw: string) => {
    const value = resolvePath(vars, raw);
    if (value === undefined || value === null || value === '') return match;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return match;
    }
  });
}

function resolvePath(root: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
