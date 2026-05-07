'use client';

// Manager-only CRUD for brand-owned calendars. Each calendar has an owner
// (the closer who'll see events in their Gmail/Outlook), an optional
// external binding, and a list of agents who can_book into it.

import { useEffect, useState, useTransition } from 'react';
import {
  bindCalendarToProvider,
  createCalendar,
  deleteCalendar,
  listOwnerExternalCalendars,
  setCalendarMembers,
  unbindCalendar,
  updateCalendar,
} from '@/app/actions/calendars';
import type { CalendarRow } from '@/lib/calendars';
import type { TeamRow } from '@/lib/team';

const COLOR_OPTIONS: { value: string; label: string; dot: string }[] = [
  { value: 'teal', label: 'Teal', dot: 'bg-teal' },
  { value: 'hp', label: 'Red', dot: 'bg-hp' },
  { value: 'vl', label: 'Purple', dot: 'bg-vl' },
  { value: 'amber', label: 'Amber', dot: 'bg-amber-500' },
];

export function CalendarsManager({
  initialCalendars,
  team,
}: {
  initialCalendars: CalendarRow[];
  team: TeamRow[];
}) {
  const [items, setItems] = useState<CalendarRow[]>(initialCalendars);
  const [error, setError] = useState<string | null>(null);

  function refreshLocal(id: string, patch: Partial<CalendarRow>) {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  return (
    <div className="space-y-4">
      <AddCalendar
        team={team}
        onError={setError}
        onAdded={(c) => setItems((prev) => [...prev, c])}
      />
      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface px-6 py-10 text-center text-[12.5px] text-txt-3">
          No calendars yet. Create one above for each closer who needs an
          assignable calendar.
        </div>
      ) : (
        items.map((cal) => (
          <CalendarItem
            key={cal.id}
            cal={cal}
            team={team}
            onChange={(patch) => refreshLocal(cal.id, patch)}
            onDelete={() => setItems((prev) => prev.filter((x) => x.id !== cal.id))}
            onError={setError}
          />
        ))
      )}
    </div>
  );
}

function AddCalendar({
  team,
  onAdded,
  onError,
}: {
  team: TeamRow[];
  onAdded: (c: CalendarRow) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('teal');
  const [ownerMemberId, setOwnerMemberId] = useState<string>(team[0]?.memberId ?? '');
  const [saving, setSaving] = useState(false);
  const [, start] = useTransition();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    start(async () => {
      const res = await createCalendar({
        name: trimmed,
        color,
        ownerMemberId: ownerMemberId || null,
      });
      setSaving(false);
      if (!res.ok) {
        onError(res.error);
        return;
      }
      const owner = team.find((t) => t.memberId === ownerMemberId);
      onAdded({
        id: res.id,
        brandId: '',
        name: trimmed,
        color,
        ownerMemberId: ownerMemberId || null,
        ownerName: owner?.fullName?.trim() || owner?.email || null,
        ownerAccountId: null,
        ownerAccountEmail: null,
        extProvider: null,
        extCalendarId: null,
        extLastSyncAt: null,
        defaultDurationMin: 30,
        isActive: true,
        members: ownerMemberId
          ? [
              {
                memberId: ownerMemberId,
                fullName: owner?.fullName ?? null,
                email: owner?.email ?? null,
                canBook: true,
                isOwner: true,
              },
            ]
          : [],
      });
      setName('');
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Calendar name (e.g. Closer A)"
        className="min-w-[220px] flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
      />
      <select
        value={ownerMemberId}
        onChange={(e) => setOwnerMemberId(e.target.value)}
        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none"
      >
        <option value="">No owner</option>
        {team.map((t) => (
          <option key={t.memberId} value={t.memberId}>
            {t.fullName?.trim() || t.email}
          </option>
        ))}
      </select>
      <select
        value={color}
        onChange={(e) => setColor(e.target.value)}
        className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12px] outline-none"
      >
        {COLOR_OPTIONS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={saving || !name.trim()}
        className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
      >
        {saving ? 'Adding…' : 'Add calendar'}
      </button>
    </div>
  );
}

function CalendarItem({
  cal,
  team,
  onChange,
  onDelete,
  onError,
}: {
  cal: CalendarRow;
  team: TeamRow[];
  onChange: (patch: Partial<CalendarRow>) => void;
  onDelete: () => void;
  onError: (msg: string) => void;
}) {
  const [, start] = useTransition();
  const [showBind, setShowBind] = useState(false);

  function rename(name: string) {
    const t = name.trim();
    if (!t || t === cal.name) return;
    onChange({ name: t });
    start(async () => {
      const res = await updateCalendar({ id: cal.id, name: t });
      if (!res.ok) onError(res.error);
    });
  }

  function changeColor(color: string) {
    onChange({ color });
    start(async () => {
      const res = await updateCalendar({ id: cal.id, color });
      if (!res.ok) onError(res.error);
    });
  }

  function changeOwner(ownerMemberId: string) {
    onChange({ ownerMemberId: ownerMemberId || null });
    start(async () => {
      const res = await updateCalendar({
        id: cal.id,
        ownerMemberId: ownerMemberId || null,
      });
      if (!res.ok) onError(res.error);
    });
  }

  function toggleMember(memberId: string, on: boolean) {
    const next = on
      ? [...cal.members.map((m) => m.memberId), memberId]
      : cal.members.filter((m) => m.memberId !== memberId).map((m) => m.memberId);
    onChange({
      members: on
        ? [
            ...cal.members,
            {
              memberId,
              fullName: team.find((t) => t.memberId === memberId)?.fullName ?? null,
              email: team.find((t) => t.memberId === memberId)?.email ?? null,
              canBook: true,
              isOwner: false,
            },
          ]
        : cal.members.filter((m) => m.memberId !== memberId),
    });
    start(async () => {
      const res = await setCalendarMembers({ id: cal.id, memberIds: Array.from(new Set(next)) });
      if (!res.ok) onError(res.error);
    });
  }

  function remove() {
    if (!window.confirm(`Delete calendar "${cal.name}"? Existing appointments lose their binding.`)) {
      return;
    }
    start(async () => {
      const res = await deleteCalendar({ id: cal.id });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onDelete();
    });
  }

  function unbind() {
    if (!window.confirm('Unbind external calendar? New events stop syncing.')) return;
    start(async () => {
      const res = await unbindCalendar({ calendarId: cal.id });
      if (!res.ok) onError(res.error);
      else
        onChange({
          extProvider: null,
          extCalendarId: null,
          ownerAccountId: null,
          ownerAccountEmail: null,
        });
    });
  }

  const colorDot = COLOR_OPTIONS.find((c) => c.value === cal.color)?.dot ?? 'bg-teal';

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${colorDot}`} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              defaultValue={cal.name}
              onBlur={(e) => rename(e.currentTarget.value)}
              className="rounded-md border border-transparent bg-transparent px-2 py-1 text-[14px] font-semibold hover:border-line focus:border-teal/60 focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-teal/20"
            />
            <select
              value={cal.color ?? 'teal'}
              onChange={(e) => changeColor(e.target.value)}
              className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11.5px] outline-none"
            >
              {COLOR_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={remove}
              className="ml-auto rounded-lg px-2.5 py-1 text-[11.5px] text-hp hover:bg-hp/10"
            >
              Delete
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-txt-3">Owner</span>
            <select
              value={cal.ownerMemberId ?? ''}
              onChange={(e) => changeOwner(e.target.value)}
              className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-[12px] outline-none"
            >
              <option value="">No owner</option>
              {team.map((t) => (
                <option key={t.memberId} value={t.memberId}>
                  {t.fullName?.trim() || t.email}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-txt-3">
              The closer whose Google/Outlook calendar gets the events.
            </span>
          </div>

          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-wide text-txt-3">
              Booking access
            </div>
            <div className="flex flex-wrap gap-1.5">
              {team.map((t) => {
                const checked = cal.members.some((m) => m.memberId === t.memberId);
                const isOwner = t.memberId === cal.ownerMemberId;
                return (
                  <label
                    key={t.memberId}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] ${
                      checked ? 'border-teal/40 bg-teal/10 text-teal' : 'border-line text-txt-2 hover:bg-canvas'
                    } ${isOwner ? 'opacity-70' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={checked}
                      disabled={isOwner}
                      onChange={(e) => toggleMember(t.memberId, e.currentTarget.checked)}
                    />
                    <span>{t.fullName?.trim() || t.email}</span>
                    {isOwner && <span className="text-[10px] uppercase">owner</span>}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
            <span className="text-[11px] uppercase tracking-wide text-txt-3">External</span>
            {cal.extProvider ? (
              <>
                <span className="rounded-full bg-teal/10 px-2 py-0.5 text-[11px] font-medium text-teal">
                  {cal.extProvider} · {cal.extCalendarId?.slice(0, 24)}…
                </span>
                {cal.ownerAccountEmail && (
                  <span className="text-[11px] text-txt-3">via {cal.ownerAccountEmail}</span>
                )}
                <button
                  type="button"
                  onClick={() => setShowBind(true)}
                  className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11.5px] hover:bg-surface-2"
                >
                  Change
                </button>
                <button
                  type="button"
                  onClick={unbind}
                  className="rounded-lg px-2.5 py-1 text-[11.5px] text-hp hover:bg-hp/10"
                >
                  Unbind
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setShowBind(true)}
                disabled={!cal.ownerMemberId}
                className="rounded-lg bg-canvas border border-line px-2.5 py-1 text-[11.5px] hover:bg-surface-2 disabled:opacity-50"
              >
                Bind to Google / Outlook
              </button>
            )}
            {cal.extLastSyncAt && (
              <span className="text-[11px] text-txt-3">
                Last sync {new Date(cal.extLastSyncAt).toLocaleString()}
              </span>
            )}
          </div>

          {showBind && (
            <BindPicker
              calendarId={cal.id}
              onClose={() => setShowBind(false)}
              onBound={(provider, extCalendarId, accountId, accountEmail) => {
                onChange({
                  extProvider: provider,
                  extCalendarId,
                  ownerAccountId: accountId,
                  ownerAccountEmail: accountEmail,
                });
                setShowBind(false);
              }}
              onError={onError}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type AccountChoice = { id: string; accountEmail: string };
type ExtCal = { id: string; name: string; primary: boolean };

// Two-step bind picker. If the calendar's owner has multiple connected
// Google accounts, step 1 is the account chooser. Step 2 is the calendar
// list for the chosen account. With a single account we skip step 1.
function BindPicker({
  calendarId,
  onClose,
  onBound,
  onError,
}: {
  calendarId: string;
  onClose: () => void;
  onBound: (
    provider: 'google',
    extCalendarId: string,
    accountId: string,
    accountEmail: string,
  ) => void;
  onError: (msg: string) => void;
}) {
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [items, setItems] = useState<ExtCal[] | null>(null);
  const [provider, setProvider] = useState<'google' | null>(null);
  const [loading, setLoading] = useState(true);
  const [, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listOwnerExternalCalendars({ calendarId });
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        onError(res.error);
        onClose();
        return;
      }
      setProvider(res.provider);
      setAccounts(res.accounts);
      if (res.items) {
        // Single account → action returned calendars directly.
        setAccountId(res.accounts[0]?.id ?? null);
        setItems(res.items);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendarId]);

  async function chooseAccount(id: string) {
    setLoading(true);
    setAccountId(id);
    const res = await listOwnerExternalCalendars({ calendarId, accountId: id });
    setLoading(false);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    setItems(res.items ?? []);
  }

  function pick(extCalendarId: string) {
    if (!provider || !accountId) return;
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    start(async () => {
      const res = await bindCalendarToProvider({
        calendarId,
        provider,
        extCalendarId,
        accountId,
      });
      if (!res.ok) {
        onError(res.error);
        return;
      }
      onBound(provider, extCalendarId, accountId, account.accountEmail);
    });
  }

  return (
    <div className="rounded-xl border border-line bg-canvas p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] font-semibold">
          {items === null ? 'Pick an account' : 'Pick a calendar'}
        </span>
        {accountId && items !== null && accounts.length > 1 && (
          <button
            type="button"
            onClick={() => {
              setItems(null);
              setAccountId(null);
            }}
            className="rounded-md px-2 py-0.5 text-[11px] text-txt-3 hover:bg-surface-2"
          >
            ← Change account
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md px-2 py-0.5 text-[11px] text-txt-3 hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
      {loading ? (
        <div className="text-[12px] text-txt-3">Loading…</div>
      ) : items === null ? (
        <ul className="space-y-1">
          {accounts.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => chooseAccount(a.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-surface-2"
              >
                <span className="truncate">{a.accountEmail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="text-[12px] text-txt-3">No calendars available on this account.</div>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => pick(i.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-surface-2"
              >
                <span className="truncate">{i.name}</span>
                {i.primary && (
                  <span className="ml-auto rounded-full bg-teal/10 px-1.5 py-0.5 text-[10px] text-teal">
                    primary
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
