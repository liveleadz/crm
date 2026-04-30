'use server';

// Server actions for the topbar notifications bell. RLS handles access; we
// only need to update the read_at column for the current member.

import { createServerClient } from '@leadpilot/db/server';
import { getActiveBrand } from '@/lib/active-brand';

export async function markNotificationRead(input: { id: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const brand = await getActiveBrand();
  if (!brand) return { ok: false, error: 'no active brand' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', input.id)
    .eq('brand_id', brand.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function markAllNotificationsRead(): Promise<{ ok: true } | { ok: false; error: string }> {
  const brand = await getActiveBrand();
  if (!brand) return { ok: false, error: 'no active brand' };
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('brand_id', brand.id)
    .is('read_at', null);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
