// Lead-import helpers — column catalog, header auto-detection, phone normalization.
// Used by both the import wizard (client) and the import server action.

export const LEAD_COLUMNS = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'zip', label: 'Zip' },
  { value: 'notes', label: 'Notes' },
  // Comma- or semicolon-separated tag names. Resolved to tag rows in the
  // import action — new names create tags on the fly.
  { value: 'tags', label: 'Tags' },
] as const;

export type LeadColumn = (typeof LEAD_COLUMNS)[number]['value'];

// Possible mapping target for a CSV header.
//   '__skip__'      = ignore this column
//   '__custom__'    = stash into leads.custom JSONB under the original header key (legacy passthrough)
//   `custom:<slug>` = stash into leads.custom JSONB under a defined custom field's slug
//   any LeadColumn  = direct column mapping
export type MappingTarget = '__skip__' | '__custom__' | `custom:${string}` | LeadColumn;

export function isCustomTarget(t: MappingTarget): t is `custom:${string}` {
  return typeof t === 'string' && t.startsWith('custom:');
}

export type FieldMapping = Record<string, MappingTarget>;

// Auto-suggest a target column based on header name (case/space insensitive).
const AUTO_RULES: Array<[RegExp, LeadColumn]> = [
  [/^first[\s_]*name$|^fname$|^given$/i, 'first_name'],
  [/^last[\s_]*name$|^lname$|^surname$|^family$/i, 'last_name'],
  [/^name$/i, 'first_name'], // fallback for single-name col → first_name
  [/^e?mail$|email[\s_]*address/i, 'email'],
  [/^phone|^mobile|^cell|^tel/i, 'phone'],
  [/^city$|town/i, 'city'],
  [/^state$|province|region/i, 'state'],
  [/^zip$|postal|postcode/i, 'zip'],
  [/^notes?$|comment|remark|memo/i, 'notes'],
  [/^tags?$|^labels?$|^categor(y|ies)$/i, 'tags'],
];

export function autoMapHeader(header: string): MappingTarget {
  const h = header.trim();
  if (!h) return '__skip__';
  for (const [re, target] of AUTO_RULES) {
    if (re.test(h)) return target;
  }
  // Unrecognized headers default to skip (no data captured) instead of
  // custom field so importing a 70-column CSV doesn't auto-stash 60+
  // arbitrary fields into leads.custom. Users can opt into custom
  // capture per-column from the dropdown.
  return '__skip__';
}

export function autoMapHeaders(headers: string[]): FieldMapping {
  const used = new Set<LeadColumn>();
  const map: FieldMapping = {};
  for (const h of headers) {
    const t = autoMapHeader(h);
    const isLeadCol = t !== '__skip__' && t !== '__custom__' && !isCustomTarget(t);
    // Avoid double-assigning the same lead column to two different headers.
    if (isLeadCol && used.has(t as LeadColumn)) {
      map[h] = '__custom__';
    } else {
      map[h] = t;
      if (isLeadCol) used.add(t as LeadColumn);
    }
  }
  return map;
}

// Country defaults for phone normalization. We only carry the dial code
// and the "national number length" used to detect whether a bare digit
// string is already in national format and just needs the prefix.
//
// Adding a country is one row here; the wizard surfaces this whole list
// in its dropdown.
export const PHONE_COUNTRIES = [
  { code: 'US', label: 'United States (+1)', dial: '1', national: 10 },
  { code: 'CA', label: 'Canada (+1)', dial: '1', national: 10 },
  { code: 'GB', label: 'United Kingdom (+44)', dial: '44', national: 10 },
  { code: 'AU', label: 'Australia (+61)', dial: '61', national: 9 },
  { code: 'BR', label: 'Brazil (+55)', dial: '55', national: 11 },
] as const;

export type PhoneCountry = (typeof PHONE_COUNTRIES)[number]['code'];

const COUNTRY_BY_CODE = new Map(PHONE_COUNTRIES.map((c) => [c.code, c]));

// Normalize a phone string to E.164. `country` picks the dial code used
// when the input has no leading `+` and isn't already prefixed with the
// dial code itself. Returns null if unusable.
export function normalizePhone(
  raw: string | null | undefined,
  country: PhoneCountry = 'US',
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;
  // Explicit international format always wins.
  if (trimmed.startsWith('+')) return `+${digits}`;
  const meta = COUNTRY_BY_CODE.get(country) ?? COUNTRY_BY_CODE.get('US')!;
  if (digits.length === meta.national) return `+${meta.dial}${digits}`;
  if (
    digits.length === meta.national + meta.dial.length &&
    digits.startsWith(meta.dial)
  ) {
    return `+${digits}`;
  }
  // Anything else, null — flagged as a warning by applyMapping.
  return null;
}

export function normalizeState(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  return s.length >= 2 ? s.slice(0, 2) : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  return s.includes('@') ? s : null;
}

// Apply mapping to a parsed CSV row. Returns a partial lead record + custom blob.
// Two channels:
//   warnings — non-blocking (e.g. unparseable phone → field stored as null, row still inserts)
//   errors   — blocking (no name/email/phone at all → row skipped)
export type MappedLead = {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  tags: string[];
  custom: Record<string, string>;
  warnings: string[];
  errors: string[];
};

export function applyMapping(
  row: Record<string, string>,
  mapping: FieldMapping,
  opts?: { defaultCountry?: PhoneCountry },
): MappedLead {
  const out: MappedLead = {
    first_name: null,
    last_name: null,
    email: null,
    phone: null,
    city: null,
    state: null,
    zip: null,
    notes: null,
    tags: [],
    custom: {},
    warnings: [],
    errors: [],
  };

  for (const [header, target] of Object.entries(mapping)) {
    const raw = row[header]?.trim();
    if (!raw) continue;
    if (target === '__skip__') continue;
    if (target === '__custom__') {
      out.custom[header] = raw;
      continue;
    }
    if (isCustomTarget(target)) {
      const slug = target.slice('custom:'.length);
      if (slug) out.custom[slug] = raw;
      continue;
    }
    if (target === 'email') {
      const e = normalizeEmail(raw);
      if (e) out.email = e;
      else out.warnings.push(`Bad email: "${raw}"`);
    } else if (target === 'phone') {
      const p = normalizePhone(raw, opts?.defaultCountry ?? 'US');
      if (p) out.phone = p;
      else out.warnings.push(`Bad phone: "${raw}"`);
    } else if (target === 'state') {
      out.state = normalizeState(raw);
    } else if (target === 'tags') {
      // Split on comma or semicolon, trim each, drop empties, dedupe (case-insensitive).
      const seen = new Set<string>();
      for (const part of raw.split(/[,;]/)) {
        const t = part.trim();
        if (!t) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.tags.push(t);
      }
    } else {
      out[target] = raw;
    }
  }

  // A row is valid if it has at least one of name/email/phone.
  if (!out.first_name && !out.last_name && !out.email && !out.phone) {
    out.errors.push('No name, email, or phone — skipped');
  }
  return out;
}
