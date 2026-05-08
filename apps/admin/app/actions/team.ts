'use server';

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@leadpilot/db/server';
import { createAdminClient } from '@leadpilot/db/admin';
import { requireBrandRole, type MemberRole } from '@/lib/team';
import { getPublicAppUrl } from '@/lib/dialer';

// Where the Supabase invite email's "Accept invite" link lands. Supabase
// hashes the auth code, then 302s the user back to this URL with `?code=`.
// `/auth/callback` exchanges the code for a session cookie and forwards
// to `/welcome`, which gates the password-setup form.
function inviteRedirectUrl() {
  return `${getPublicAppUrl()}/auth/callback?next=/welcome`;
}

const ROLES: MemberRole[] = ['owner', 'admin', 'manager', 'agent', 'viewer'];

function isRole(v: unknown): v is MemberRole {
  return typeof v === 'string' && (ROLES as string[]).includes(v);
}

// Team management — invites, role changes, removals — is admin/owner
// only. Managers can run the team, but only admins can shape it.
async function requireManager() {
  return requireBrandRole('admin');
}

function bump() {
  revalidatePath('/team');
  revalidatePath('/', 'layout');
}

export async function inviteMember(input: { email: string; role: MemberRole }) {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return { ok: false as const, error: 'Valid email required' };
  }
  if (!isRole(input.role) || input.role === 'owner') {
    return { ok: false as const, error: 'Invalid role' };
  }

  const admin = createAdminClient();

  // Look up existing member by email (handle_new_user trigger creates this row
  // automatically when a user signs up).
  const { data: existing } = await admin
    .from('members')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();

  let memberId: string;
  if (existing) {
    memberId = existing.id;
  } else {
    // Send Supabase auth invite. The trigger will create the members row when
    // the invitee accepts and an auth.users record is created. `redirectTo`
    // sends the invitee back through our `/auth/callback` so the session
    // cookie is set before they land on `/welcome`.
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: inviteRedirectUrl(),
    });
    if (inviteErr || !invited?.user) {
      return { ok: false as const, error: inviteErr?.message ?? 'Invite failed' };
    }
    memberId = invited.user.id;
    // Ensure members row exists immediately so the brand_members FK insert below works.
    await admin
      .from('members')
      .upsert({ id: memberId, email }, { onConflict: 'id' });
  }

  // Upsert brand membership (re-invite reactivates if previously deactivated).
  const { error: bmErr } = await admin
    .from('brand_members')
    .upsert(
      { brand_id: guard.brandId, member_id: memberId, role: input.role, is_active: true },
      { onConflict: 'brand_id,member_id' },
    );
  if (bmErr) return { ok: false as const, error: bmErr.message };

  bump();
  return { ok: true as const, memberId };
}

export async function updateMemberRole(memberId: string, role: MemberRole) {
  const guard = await requireManager();
  if (!guard.ok) return guard;
  if (!isRole(role)) return { ok: false as const, error: 'Invalid role' };
  if (role === 'owner') return { ok: false as const, error: 'Cannot grant owner from UI' };

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from('brand_members')
    .select('role')
    .eq('brand_id', guard.brandId)
    .eq('member_id', memberId)
    .maybeSingle();
  if (target?.role === 'owner') {
    return { ok: false as const, error: 'Cannot change owner role' };
  }

  const { error } = await supabase
    .from('brand_members')
    .update({ role })
    .eq('brand_id', guard.brandId)
    .eq('member_id', memberId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}

export async function setMemberActive(memberId: string, isActive: boolean) {
  const guard = await requireManager();
  if (!guard.ok) return guard;

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from('brand_members')
    .select('role, member_id')
    .eq('brand_id', guard.brandId)
    .eq('member_id', memberId)
    .maybeSingle();
  if (target?.role === 'owner') {
    return { ok: false as const, error: 'Cannot deactivate the owner' };
  }

  const { error } = await supabase
    .from('brand_members')
    .update({ is_active: isActive })
    .eq('brand_id', guard.brandId)
    .eq('member_id', memberId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}

export async function resendInvite(memberId: string) {
  const guard = await requireManager();
  if (!guard.ok) return guard;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from('members')
    .select('email')
    .eq('id', memberId)
    .maybeSingle();
  if (!target?.email) {
    return { ok: false as const, error: 'Member not found' };
  }

  // Confirm the invitee is still in the brand before sending another link.
  const { data: bm } = await admin
    .from('brand_members')
    .select('role')
    .eq('brand_id', guard.brandId)
    .eq('member_id', memberId)
    .maybeSingle();
  if (!bm) return { ok: false as const, error: 'Not a member of this brand' };

  // Supabase resends the invite email when the user is unconfirmed; for a
  // confirmed user it errors with "User already registered" — we surface
  // that message verbatim so the manager can act on it.
  const { error } = await admin.auth.admin.inviteUserByEmail(target.email, {
    redirectTo: inviteRedirectUrl(),
  });
  if (error) return { ok: false as const, error: error.message };

  bump();
  return { ok: true as const };
}

export async function removeMember(memberId: string) {
  const guard = await requireManager();
  if (!guard.ok) return guard;

  const supabase = await createServerClient();
  const { data: target } = await supabase
    .from('brand_members')
    .select('role')
    .eq('brand_id', guard.brandId)
    .eq('member_id', memberId)
    .maybeSingle();
  if (target?.role === 'owner') {
    return { ok: false as const, error: 'Cannot remove the owner' };
  }

  const { error } = await supabase
    .from('brand_members')
    .delete()
    .eq('brand_id', guard.brandId)
    .eq('member_id', memberId);
  if (error) return { ok: false as const, error: error.message };
  bump();
  return { ok: true as const };
}
