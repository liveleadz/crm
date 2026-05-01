// Team helpers — load brand members + role utilities.
import 'server-only';
import { createAdminClient } from '@leadpilot/db/admin';
import { createServerClient } from '@leadpilot/db/server';
import type { Database } from '@leadpilot/db/types';

export type MemberRole = Database['public']['Enums']['member_role'];

export type TeamRow = {
  memberId: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  mobilePhone: string | null;
  role: MemberRole;
  isActive: boolean;
  joinedAt: string;
  /** True when the auth.users record exists but email_confirmed_at is
   *  still null — i.e. the invite link hasn't been clicked yet. */
  pendingInvite: boolean;
};

export const ROLE_RANK: Record<MemberRole, number> = {
  owner: 4,
  admin: 3,
  manager: 2,
  agent: 1,
  viewer: 0,
};

export function canManageTeam(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin';
}

export function canSeeManagement(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export async function getCurrentBrandRole(brandId: string): Promise<MemberRole | null> {
  const supabase = await createServerClient();
  const { data } = await supabase.rpc('brand_role', { b: brandId });
  return (data as MemberRole | null) ?? null;
}

export async function loadTeam(brandId: string): Promise<TeamRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('brand_members')
    .select(
      'role, is_active, created_at, members!inner(id, email, full_name, avatar_url, mobile_phone)',
    )
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  // Resolve pending-invite status by checking email_confirmed_at on
  // auth.users for the members in this brand. Listed via the admin
  // client (RLS doesn't apply to auth.users from the JS client). We
  // tolerate failures silently — pending state is informational.
  const confirmedById = new Map<string, boolean>();
  try {
    const admin = createAdminClient();
    const { data: usersPage } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    for (const u of usersPage?.users ?? []) {
      confirmedById.set(u.id, !!u.email_confirmed_at);
    }
  } catch {
    // Ignore; pending flag will default to false.
  }

  return data.map((row) => ({
    memberId: row.members.id,
    email: row.members.email,
    fullName: row.members.full_name,
    avatarUrl: row.members.avatar_url,
    mobilePhone: row.members.mobile_phone,
    role: row.role,
    isActive: row.is_active,
    joinedAt: row.created_at,
    pendingInvite: confirmedById.has(row.members.id)
      ? !confirmedById.get(row.members.id)
      : false,
  }));
}
