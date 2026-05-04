// Common keys we accept for "company name" in the leads.custom JSONB,
// since there's no first-class column on leads. Order matters — first
// hit wins.
export const COMPANY_KEYS = [
  'company',
  'company_name',
  'companyName',
  'Company',
  'Company Name',
  'business',
  'business_name',
  'organization',
  'org',
];

export function pickCompanyFromCustom(custom: unknown): string | null {
  if (!custom || typeof custom !== 'object') return null;
  const obj = custom as Record<string, unknown>;
  for (const k of COMPANY_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
