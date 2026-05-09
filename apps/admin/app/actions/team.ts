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

// Create an agent account that logs in with a username + password
// instead of an emailed invite link. Used for power-dialer agents
// (Victor, etc.) who share devices and prefer a short handle. The
// `email` is still required by Supabase Auth — it can be the agent's
// real inbox so password resets work.
export async function createAgentAccount(input: {
  fullName: string;
  email: string;
  username: string;
  password: string;
  role: MemberRole;
}) {
  const guard = await requireManager();
  if (!guard.ok) return guard;

  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim().toLowerCase();
  const password = input.password;
  const role = input.role;

  if (!fullName) return { ok: false as const, error: 'Full name required' };
  if (!email.includes('@')) return { ok: false as const, error: 'Valid email required' };
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
    return {
      ok: false as const,
      error: 'Username must be 3–32 chars: lowercase letters, digits, _ . -',
    };
  }
  if (password.length < 8) {
    return { ok: false as const, error: 'Password must be at least 8 characters' };
  }
  if (!isRole(role) || role === 'owner') {
    return { ok: false as const, error: 'Invalid role' };
  }

  const admin = createAdminClient();

  // Username must be globally unique (RLS-bypassed lookup).
  const { data: existingUsername } = await admin
    .from('members')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  if (existingUsername) {
    return { ok: false as const, error: 'Username already taken' };
  }

  // Reuse member if email already has an account; otherwise create one.
  const { data: existingByEmail } = await admin
    .from('members')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  let memberId: string;
  if (existingByEmail) {
    memberId = existingByEmail.id;
    // Reset password on the existing auth user so the manager can hand
    // out the new credentials cleanly.
    const { error: pwErr } = await admin.auth.admin.updateUserById(memberId, {
      password,
      email_confirm: true,
    });
    if (pwErr) return { ok: false as const, error: pwErr.message };
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (createErr || !created?.user) {
      return { ok: false as const, error: createErr?.message ?? 'Could not create user' };
    }
    memberId = created.user.id;
    // The handle_new_user trigger inserts a members row, but upsert
    // here guarantees full_name lands even if the trigger races.
    await admin
      .from('members')
      .upsert({ id: memberId, email, full_name: fullName }, { onConflict: 'id' });
  }

  // Set username + name (idempotent — covers both branches above).
  const { error: profileErr } = await admin
    .from('members')
    .update({ username, full_name: fullName })
    .eq('id', memberId);
  if (profileErr) return { ok: false as const, error: profileErr.message };

  // Wire into the active brand.
  const { error: bmErr } = await admin
    .from('brand_members')
    .upsert(
      { brand_id: guard.brandId, member_id: memberId, role, is_active: true },
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
