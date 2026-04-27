// Supabase server client — for use in Server Components, Route Handlers, and Server Actions.
import { createServerClient as createSSRClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './types.gen';

export async function createServerClient() {
  const cookieStore = await cookies();
  return createSSRClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(items: { name: string; value: string; options?: CookieOptions }[]) {
          try {
            for (const { name, value, options } of items) {
              cookieStore.set(name, value, options as CookieOptions);
            }
          } catch {
            // Server Components cannot set cookies — swallow; middleware refreshes session.
          }
        },
      },
    },
  );
}
