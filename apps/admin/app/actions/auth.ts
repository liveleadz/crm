'use server';

import { createServerClient } from '@leadpilot/db/server';
import { redirect } from 'next/navigation';

export async function signOut() {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
