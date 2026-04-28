'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { BrandId } from '@leadpilot/ui';

const ALLOWED: BrandId[] = ['hp', 'vl', 'bs', 'll', 'hb', 'bi'];

export async function setActiveBrand(brandId: string) {
  if (!ALLOWED.includes(brandId as BrandId)) return;
  const cookieStore = await cookies();
  cookieStore.set('lp_brand', brandId, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  revalidatePath('/', 'layout');
}
