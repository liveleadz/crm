'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import {
  createAgentAccount,
  inviteMember,
  removeMember,
  resendInvite,
  setMemberActive,
  updateMemberRole,
} from '@/app/actions/team';
import type { MemberRole, TeamRow } from '@/lib/team';

const ROLE_OPTIONS: { value: MemberRole; label: string; hint: string }[] = [
  { value: 'admin', label: 'Admin', hint: 'Full brand access except owner-only actions' },
  { value: 'manager', label: 'Manager', hint: 'Team + numbers + reporting' },
  { value: 'agent', label: 'Agent', hint: 'Dial, work leads, log calls' },
  { value: 'viewer', label: 'Viewer', hint: 'Read-only' },
];

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  agent: 'Agent',
  viewer: 'Viewer',
};

const ROLE_DOT: Record<MemberRole, string> = {
  owner: 'bg-teal',
  admin: 'bg-bs',
  manager: 'bg-vl',
  agent: 'bg-ll',
  viewer: 'bg-txt-3',
};

function initials(name: string | null, email: string) {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

export function TeamManager({
  initialTeam,
  currentMemberId,
}: {
  initialTeam: TeamRow[];
  currentMemberId: string;
}) {
  const [team, setTeam] = useState(initialTeam);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setTeam(initialTeam), [initialTeam]);

  function changeRole(memberId: string, role: MemberRole) {
    setError(null);
    const prev = team;
    setTeam((t) => t.map((m) => (m.memberId === memberId ? { ...m, role } : m)));
    startTransition(async () => {
      const res = await updateMemberRole(memberId, role);
      if (!res.ok) {
        setTeam(prev);
        setError(res.error);
      }
    });
  }

  function toggleActive(memberId: string, isActive: boolean) {
    setError(null);
    const prev = team;
    setTeam((t) => t.map((m) => (m.memberId === memberId ? { ...m, isActive } : m)));
    startTransition(async () => {
      const res = await setMemberActive(memberId, isActive);
      if (!res.ok) {
        setTeam(prev);
        setError(res.error);
      }
    });
  }

  function remove(memberId: string) {
    if (!confirm('Remove this member from the brand?')) return;
    setError(null);
    const prev = team;
    setTeam((t) => t.filter((m) => m.memberId !== memberId));
    startTransition(async () => {
      const res = await removeMember(memberId);
      if (!res.ok) {
        setTeam(prev);
        setError(res.error);
      }
    });
  }

  function resend(memberId: string) {
    setError(null);
    startTransition(async () => {
      const res = await resendInvite(memberId);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[12px] text-txt-3">
          {team.length} {team.length === 1 ? 'member' : 'members'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCreateAgentOpen(true)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas"
          >
            + Create agent (username login)
          </button>
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90"
          >
            + Invite member
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] text-hp">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-[11px] uppercase tracking-wide text-txt-3">
              <th className="px-4 py-2 font-semibold">Member</th>
              <th className="px-4 py-2 font-semibold">Role</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Joined</th>
              <th className="w-px px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {team.map((m) => {
              const isOwner = m.role === 'owner';
              const isSelf = m.memberId === currentMemberId;
              return (
                <tr
                  key={m.memberId}
                  className="border-b border-line last:border-b-0 hover:bg-canvas/40"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/team/${m.memberId}`}
                      className="flex items-center gap-2.5 hover:opacity-90"
                    >
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-teal/15 text-[11px] font-semibold text-teal">
                        {initials(m.fullName, m.email)}
                      </div>
                      <div>
                        <div className="font-medium hover:text-teal">
                          {m.fullName ?? m.email.split('@')[0]}
                          {isSelf && (
                            <span className="ml-2 text-[10.5px] text-txt-3">(you)</span>
                          )}
                        </div>
                        <div className="text-[11.5px] text-txt-3">{m.email}</div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    {isOwner ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
                        <span className={`h-2 w-2 rounded-full ${ROLE_DOT.owner}`} />
                        Owner
                      </span>
                    ) : (
                      <select
                        value={m.role}
                        onChange={(e) => changeRole(m.memberId, e.target.value as MemberRole)}
                        className="rounded-lg border border-line bg-canvas px-2 py-1 text-[12px] outline-none focus:border-teal/60"
                      >
                        {ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {isOwner ? (
                      <span className="text-[12px] text-txt-3">Active</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleActive(m.memberId, !m.isActive)}
                          className={`inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            m.isActive ? 'bg-teal' : 'bg-line-2'
                          }`}
                          aria-label={m.isActive ? 'Deactivate' : 'Activate'}
                        >
                          <span
                            className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                              m.isActive ? 'translate-x-5' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                        {m.pendingInvite && (
                          <span
                            title="Invite link not yet accepted"
                            className="rounded-full border border-bi/40 bg-bi/10 px-2 py-0.5 text-[10.5px] font-medium text-bi"
                          >
                            Pending
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-[11.5px] text-txt-3">
                    {new Date(m.joinedAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    {!isOwner && !isSelf && (
                      <div className="flex items-center justify-end gap-1">
                        {m.pendingInvite && (
                          <button
                            type="button"
                            onClick={() => resend(m.memberId)}
                            className="rounded-lg px-2 py-1 text-[11.5px] text-teal hover:bg-teal/10"
                          >
                            Resend invite
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(m.memberId)}
                          className="rounded-lg px-2 py-1 text-[11.5px] text-txt-3 hover:bg-hp/10 hover:text-hp"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          onInvited={(newMember) => {
            setTeam((t) =>
              t.find((m) => m.memberId === newMember.memberId)
                ? t.map((m) => (m.memberId === newMember.memberId ? newMember : m))
                : [...t, newMember],
            );
            setInviteOpen(false);
          }}
        />
      )}

      {createAgentOpen && (
        <CreateAgentDialog
          onClose={() => setCreateAgentOpen(false)}
          onCreated={(newMember) => {
            setTeam((t) =>
              t.find((m) => m.memberId === newMember.memberId)
                ? t.map((m) => (m.memberId === newMember.memberId ? newMember : m))
                : [...t, newMember],
            );
            setCreateAgentOpen(false);
          }}
        />
      )}
    </div>
  );
}

function InviteDialog({
  onClose,
  onInvited,
}: {
  onClose: () => void;
  onInvited: (m: TeamRow) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('agent');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit() {
    setError(null);
    setSaving(true);
    startTransition(async () => {
      const res = await inviteMember({ email, role });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onInvited({
        memberId: res.memberId,
        email: email.trim().toLowerCase(),
        fullName: null,
        avatarUrl: null,
        mobilePhone: null,
        role,
        isActive: true,
        joinedAt: new Date().toISOString(),
        pendingInvite: true,
      });
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-label="Invite member"
        className="fixed left-1/2 top-1/2 z-50 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-[13.5px] font-semibold">Invite member</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-7 w-7 place-items-center rounded-lg text-txt-3 hover:bg-canvas"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="space-y-3 p-5">
          <label className="block">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Email
            </div>
            <input
              type="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agent@example.com"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Role
            </div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.hint}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] text-hp">
              {error}
            </div>
          )}
          <p className="text-[11px] text-txt-3">
            We'll email an invite link. The member will land in {ROLE_LABEL[role]} role for this brand.
          </p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !email}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {saving ? 'Sending…' : 'Send invite'}
          </button>
        </footer>
      </div>
    </>
  );
}

function CreateAgentDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (m: TeamRow) => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<MemberRole>('agent');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit() {
    setError(null);
    setSaving(true);
    startTransition(async () => {
      const res = await createAgentAccount({ fullName, email, username, password, role });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated({
        memberId: res.memberId,
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        avatarUrl: null,
        mobilePhone: null,
        role,
        isActive: true,
        joinedAt: new Date().toISOString(),
        pendingInvite: false,
      });
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-label="Create agent"
        className="fixed left-1/2 top-1/2 z-50 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h3 className="text-[13.5px] font-semibold">Create agent (username login)</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-7 w-7 place-items-center rounded-lg text-txt-3 hover:bg-canvas"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="space-y-3 p-5">
          <label className="block">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Full name
            </div>
            <input
              type="text"
              autoFocus
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Victor"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Email
            </div>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="agent@example.com"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            />
            <p className="mt-1 text-[10.5px] text-txt-3">
              Used for password resets. Login is by username.
            </p>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                Username
              </div>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="victorliveleadz"
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
              />
            </label>
            <label className="block">
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                Password
              </div>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
              />
            </label>
          </div>
          <label className="block">
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Role
            </div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as MemberRole)}
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.hint}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[11.5px] text-hp">
              {error}
            </div>
          )}
          <p className="text-[11px] text-txt-3">
            Creates the account immediately — no email sent. Hand the username and password to
            the agent directly.
          </p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-line bg-canvas px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !fullName || !email || !username || !password}
            className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create agent'}
          </button>
        </footer>
      </div>
    </>
  );
}
