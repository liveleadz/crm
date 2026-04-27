// Refreshes the Supabase auth cookie on every request — wire from apps/admin/middleware.ts.
import { createServerClient as createSSRClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './types.gen';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createSSRClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(items: { name: string; value: string; options?: CookieOptions }[]) {
          for (const { name, value } of items) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of items) {
            response.cookies.set(name, value, options as CookieOptions);
          }
        },
      },
    },
  );

  // Important: this refreshes the session cookie if needed.
  await supabase.auth.getUser();

  return response;
}
