import { createServerClient } from '@leadpilot/db/server';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <main className="p-6">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <p className="mt-1 text-sm text-txt-2">Signed in as {user.email}.</p>
    </main>
  );
}
