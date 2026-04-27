import { createServerClient } from '@leadpilot/db/server';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');
  redirect('/dashboard');
}
