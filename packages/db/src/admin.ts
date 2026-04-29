// Admin (service-role) Supabase client. Bypasses RLS; use ONLY from
// server-side code that has already authenticated and authorized the caller.
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types.gen';

let cached: ReturnType<typeof createClient<Database>> | null = null;

export function createAdminClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  cached = createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
