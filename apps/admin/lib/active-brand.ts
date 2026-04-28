// Server-only helper: returns the active brand for the current request.
// Persisted via the `lp_brand` cookie. Falls back to the first brand the
// user is a member of, or null if they belong to none.
import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@leadpilot/db/server';
import type { BrandId } from '@leadpilot/ui';

export type ActiveBrand = {
  id: BrandId;
  name: string;
  color: string | null;
};

const ALLOWED: BrandId[] = ['hp', 'vl', 'bs', 'll', 'hb', 'bi'];

export async function getMembershipBrands(): Promise<ActiveBrand[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('brand_members')
    .select('brand_id, brands!inner(id, name, color)')
    .order('brand_id');
  if (!data) return [];
  return data
    .map((row) => row.brands)
    .filter((b): b is { id: BrandId; name: string; color: string | null } =>
      ALLOWED.includes(b.id as BrandId),
    );
}

export async function getActiveBrand(): Promise<ActiveBrand | null> {
  const brands = await getMembershipBrands();
  if (brands.length === 0) return null;
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get('lp_brand')?.value;
  const fromCookie = brands.find((b) => b.id === cookieValue);
  return fromCookie ?? brands[0]!;
}
