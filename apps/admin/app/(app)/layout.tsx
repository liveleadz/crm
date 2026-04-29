import { redirect } from 'next/navigation';
import { createServerClient } from '@leadpilot/db/server';
import { Sidebar } from '@/components/sidebar';
import { Topbar } from '@/components/topbar';
import { getActiveBrand, getMembershipBrands } from '@/lib/active-brand';
import { getCurrentBrandRole } from '@/lib/team';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [brands, active] = await Promise.all([getMembershipBrands(), getActiveBrand()]);

  if (!active) {
    return (
      <main className="grid min-h-screen place-items-center px-6">
        <div className="max-w-md rounded-lg border border-line bg-surface p-8 text-center">
          <h1 className="mb-1 text-lg font-semibold">No brand access</h1>
          <p className="text-sm text-txt-2">
            Your account ({user.email}) is not yet assigned to any brand. Ask an owner to add you in
            Settings → Team.
          </p>
        </div>
      </main>
    );
  }

  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;

  const role = await getCurrentBrandRole(active.id);

  return (
    <div className="flex h-screen flex-col">
      <Topbar brands={brands} active={active} email={user.email!} fullName={fullName} />
      <div className="flex min-h-0 flex-1">
        <Sidebar role={role} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas">{children}</main>
      </div>
    </div>
  );
}
