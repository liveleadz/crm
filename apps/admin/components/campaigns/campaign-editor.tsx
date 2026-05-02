'use client';

// Campaign detail editor. Tabs: Overview / Lists / Agents / Follow-ups /
// Activity. State is fully client-owned; each tab fires a server action and
// optimistically updates locally. Manager+ only — read-only mode is set by
// the parent passing canManage=false (agents view their assigned campaigns).

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  setCampaignAgents,
  setCampaignLists,
  updateCampaign,
  upsertFollowup,
  clearFollowup,
} from '@/app/actions/campaigns';
import type { Campaign, CampaignStatus } from '@/lib/campaigns';
import type { DispositionFollowup } from '@/lib/disposition-followups';

type Member = { id: string; fullName: string | null; email: string };
type Script = { id: string; name: string; subject: string | null };
type Calendar = { id: string; name: string };
type Pool = { id: string; name: string; numberCount: number };
type LeadList = { id: string; name: string; source: string; count: number };
type Disposition = { id: string; code: string; label: string; tone: string };
type StageOpt = { id: string; name: string };
type TagOpt = { id: string; name: string; color: string | null };
type CallRow = {
  id: string;
  startedAt: string;
  disposition: string | null;
  durationSec: number | null;
  leadName: string | null;
  memberName: string | null;
};
type AppointmentRow = {
  id: string;
  startsAt: string;
  title: string;
  status: string;
  leadName: string | null;
};

type TabKey = 'overview' | 'lists' | 'agents' | 'followups' | 'activity';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'lists', label: 'Lists' },
  { key: 'agents', label: 'Agents' },
  { key: 'followups', label: 'Follow-ups' },
  { key: 'activity', label: 'Activity' },
];

export function CampaignEditor({
  campaign,
  scripts,
  calendars,
  members,
  pools = [],
  lists,
  dispositions,
  followups,
  stages,
  tags,
  recentCalls,
  recentAppointments,
  canManage,
  brandTimezone,
}: {
  campaign: Campaign;
  scripts: Script[];
  calendars: Calendar[];
  members: Member[];
  pools?: Pool[];
  lists: LeadList[];
  dispositions: Disposition[];
  followups: DispositionFollowup[];
  stages: StageOpt[];
  tags: TagOpt[];
  recentCalls: CallRow[];
  recentAppointments: AppointmentRow[];
  canManage: boolean;
  brandTimezone: string;
}) {
  const [tab, setTab] = useState<TabKey>('overview');
  const [c, setC] = useState(campaign);
  const [error, setError] = useState<string | null>(null);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function patch(p: Partial<Campaign>) {
    setC((prev) => ({ ...prev, ...p }));
  }

  function save<T extends keyof Campaign>(field: T, value: Campaign[T]) {
    if (!canManage) return;
    patch({ [field]: value } as Partial<Campaign>);
    setError(null);
    setSavingMsg('Saving…');
    startTransition(async () => {
      const map: Record<string, keyof Parameters<typeof updateCampaign>[0]> = {
        name: 'name',
        description: 'description',
        status: 'status',
        scriptId: 'scriptId',
        calendarId: 'calendarId',
        defaultOwnerId: 'defaultOwnerId',
        phonePoolId: 'phonePoolId',
        recentlyCalledMinutes: 'recentlyCalledMinutes',
        tcpaEnabled: 'tcpaEnabled',
        dialWindowStartMin: 'dialWindowStartMin',
        dialWindowEndMin: 'dialWindowEndMin',
        skipWeekends: 'skipWeekends',
      };
      const key = map[field as string];
      if (!key) {
        setSavingMsg(null);
        return;
      }
      const res = await updateCampaign({
        id: c.id,
        [key]: value,
      } as Parameters<typeof updateCampaign>[0]);
      setSavingMsg(null);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/campaigns"
          className="text-[12px] text-txt-3 hover:text-txt-1 hover:underline"
        >
          ← All campaigns
        </Link>
        <div className="text-[11px] text-txt-3">{savingMsg}</div>
      </div>

      <div className="rounded-xl border border-line bg-surface px-4 py-3">
        <input
          type="text"
          defaultValue={c.name}
          disabled={!canManage}
          onBlur={(e) => {
            const v = e.currentTarget.value.trim();
            if (v && v !== c.name) save('name', v);
            else if (!v) e.currentTarget.value = c.name;
          }}
          className="w-full border-none bg-transparent text-[16px] font-semibold tracking-tight outline-none disabled:cursor-default"
        />
        <textarea
          defaultValue={c.description ?? ''}
          disabled={!canManage}
          placeholder={canManage ? 'Add a short description…' : ''}
          onBlur={(e) => {
            const v = e.currentTarget.value;
            if (v !== (c.description ?? '')) save('description', v || null);
          }}
          rows={2}
          className="mt-1 w-full resize-none border-none bg-transparent text-[12.5px] text-txt-2 outline-none placeholder:text-txt-3 disabled:cursor-default"
        />
      </div>

      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12px] font-medium ${
              tab === t.key
                ? 'border-teal text-txt-1'
                : 'border-transparent text-txt-3 hover:text-txt-1'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}

      {tab === 'overview' && (
        <OverviewTab
          c={c}
          scripts={scripts}
          calendars={calendars}
          members={members}
          pools={pools}
          brandTimezone={brandTimezone}
          canManage={canManage}
          onChange={save}
        />
      )}
      {tab === 'lists' && (
        <ListsTab
          campaignId={c.id}
          all={lists}
          selectedIds={c.listIds}
          onChange={(ids) => patch({ listIds: ids })}
          canManage={canManage}
          onError={setError}
        />
      )}
      {tab === 'agents' && (
        <AgentsTab
          campaignId={c.id}
          all={members}
          selectedIds={c.agentIds}
          onChange={(ids) => patch({ agentIds: ids })}
          canManage={canManage}
          onError={setError}
        />
      )}
      {tab === 'followups' && (
        <FollowupsTab
          campaignId={c.id}
          dispositions={dispositions}
          initial={followups}
          stages={stages}
          tags={tags}
          canManage={canManage}
          onError={setError}
        />
      )}
      {tab === 'activity' && (
        <ActivityTab calls={recentCalls} appointments={recentAppointments} />
      )}
    </div>
  );
}

const STATUS_OPTS: { value: CampaignStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
];

function OverviewTab({
  c,
  scripts,
  calendars,
  members,
  pools,
  brandTimezone,
  canManage,
  onChange,
}: {
  c: Campaign;
  scripts: Script[];
  calendars: Calendar[];
  members: Member[];
  pools: Pool[];
  brandTimezone: string;
  canManage: boolean;
  onChange: <K extends keyof Campaign>(field: K, value: Campaign[K]) => void;
}) {
  const fieldCls =
    'w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20 disabled:cursor-default disabled:opacity-70';
  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <Field label="Status">
        <select
          value={c.status}
          disabled={!canManage}
          onChange={(e) => onChange('status', e.target.value as CampaignStatus)}
          className={fieldCls}
        >
          {STATUS_OPTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Call script" hint="Shown in the right panel during dialing.">
        <select
          value={c.scriptId ?? ''}
          disabled={!canManage}
          onChange={(e) => onChange('scriptId', e.target.value || null)}
          className={fieldCls}
        >
          <option value="">— None —</option>
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Calendar" hint="Where appointments booked from this campaign land.">
        <select
          value={c.calendarId ?? ''}
          disabled={!canManage}
          onChange={(e) => onChange('calendarId', e.target.value || null)}
          className={fieldCls}
        >
          <option value="">— None —</option>
          {calendars.map((cal) => (
            <option key={cal.id} value={cal.id}>
              {cal.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Default appointment owner" hint="Used when nobody specific is set during booking.">
        <select
          value={c.defaultOwnerId ?? ''}
          disabled={!canManage}
          onChange={(e) => onChange('defaultOwnerId', e.target.value || null)}
          className={fieldCls}
        >
          <option value="">— None —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.fullName ?? m.email}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Caller-ID pool"
        hint="Rotate outbound numbers for this campaign. Leave blank to use the brand default."
      >
        <select
          value={c.phonePoolId ?? ''}
          disabled={!canManage}
          onChange={(e) => onChange('phonePoolId', e.target.value || null)}
          className={fieldCls}
        >
          <option value="">— Use brand default —</option>
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.numberCount} number{p.numberCount === 1 ? '' : 's'})
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Skip leads called within (minutes)"
        hint="Avoid redialing the same lead too soon. Default 240 (4 hours)."
      >
        <input
          type="number"
          min={0}
          max={43200}
          defaultValue={c.recentlyCalledMinutes}
          disabled={!canManage}
          onBlur={(e) => {
            const v = Math.max(0, parseInt(e.currentTarget.value, 10) || 0);
            if (v !== c.recentlyCalledMinutes) onChange('recentlyCalledMinutes', v);
          }}
          className={fieldCls}
        />
      </Field>
      <ComplianceCard
        c={c}
        brandTimezone={brandTimezone}
        canManage={canManage}
        onChange={onChange}
      />
    </div>
  );
}

function ComplianceCard({
  c,
  brandTimezone,
  canManage,
  onChange,
}: {
  c: Campaign;
  brandTimezone: string;
  canManage: boolean;
  onChange: <K extends keyof Campaign>(field: K, value: Campaign[K]) => void;
}) {
  const fieldCls =
    'rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20 disabled:cursor-default disabled:opacity-70';
  return (
    <div className="rounded-lg border border-line bg-canvas/40 p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[12.5px] font-semibold text-txt-1">Compliance · TCPA window</div>
          <p className="mt-0.5 text-[11px] text-txt-3">
            Soft block: leads outside the lead-local dial window are skipped from the queue and
            manual dials are refused with a clear reason. Lead state drives the timezone, falling
            back to the brand timezone (<span className="font-mono">{brandTimezone}</span>).
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-txt-2">
          <input
            type="checkbox"
            checked={c.tcpaEnabled}
            disabled={!canManage}
            onChange={(e) => onChange('tcpaEnabled', e.target.checked)}
          />
          Enable
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
            Window start
          </span>
          <input
            type="time"
            value={minToHHMM(c.dialWindowStartMin)}
            disabled={!canManage || !c.tcpaEnabled}
            onChange={(e) => {
              const m = hhmmToMin(e.target.value);
              if (m !== null && m !== c.dialWindowStartMin) onChange('dialWindowStartMin', m);
            }}
            className={fieldCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
            Window end
          </span>
          <input
            type="time"
            value={minToHHMM(c.dialWindowEndMin)}
            disabled={!canManage || !c.tcpaEnabled}
            onChange={(e) => {
              const m = hhmmToMin(e.target.value);
              if (m !== null && m !== c.dialWindowEndMin) onChange('dialWindowEndMin', m);
            }}
            className={fieldCls}
          />
        </label>
      </div>
      <label className="mt-2 flex items-center gap-1.5 text-[11.5px] text-txt-2">
        <input
          type="checkbox"
          checked={c.skipWeekends}
          disabled={!canManage || !c.tcpaEnabled}
          onChange={(e) => onChange('skipWeekends', e.target.checked)}
        />
        Skip weekends (Sat/Sun)
      </label>
    </div>
  );
}

function minToHHMM(min: number): string {
  const m = Math.max(0, Math.min(1440, min));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function hhmmToMin(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 24 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-medium">{label}</div>
      {hint && <div className="mb-1.5 text-[11px] text-txt-3">{hint}</div>}
      {children}
    </div>
  );
}

function ListsTab({
  campaignId,
  all,
  selectedIds,
  onChange,
  canManage,
  onError,
}: {
  campaignId: string;
  all: LeadList[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const [, startTransition] = useTransition();
  const materialized = all.filter((l) => l.source !== 'filter');

  function toggle(id: string) {
    if (!canManage) return;
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChange(next);
    startTransition(async () => {
      const res = await setCampaignLists({ campaignId, listIds: next });
      if (!res.ok) onError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-txt-3">
        Pick the lead lists this campaign should dial. Smart filter lists are not
        supported here — only imported / manually-built lists.
      </p>
      <div className="flex flex-wrap gap-2">
        {materialized.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-2 px-4 py-6 text-[12px] text-txt-3">
            No materialized lists in this brand yet. Import or build one in /leads.
          </div>
        ) : (
          materialized.map((l) => {
            const on = selectedIds.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggle(l.id)}
                disabled={!canManage}
                className={`rounded-full border px-3 py-1.5 text-[12px] transition ${
                  on
                    ? 'border-teal/60 bg-teal/10 text-txt-1'
                    : 'border-line bg-surface text-txt-2 hover:border-line-2'
                } disabled:cursor-default`}
              >
                {l.name}
                <span className="ml-1.5 text-[10.5px] text-txt-3">{l.count}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function AgentsTab({
  campaignId,
  all,
  selectedIds,
  onChange,
  canManage,
  onError,
}: {
  campaignId: string;
  all: Member[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const [, startTransition] = useTransition();

  function toggle(id: string) {
    if (!canManage) return;
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onChange(next);
    startTransition(async () => {
      const res = await setCampaignAgents({ campaignId, memberIds: next });
      if (!res.ok) onError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-txt-3">
        Agents assigned here see this campaign on their dashboard and can power-dial
        through it. Managers and admins can run any campaign regardless.
      </p>
      <div className="flex flex-wrap gap-2">
        {all.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-2 px-4 py-6 text-[12px] text-txt-3">
            No team members in this brand yet.
          </div>
        ) : (
          all.map((m) => {
            const on = selectedIds.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => toggle(m.id)}
                disabled={!canManage}
                className={`rounded-full border px-3 py-1.5 text-[12px] transition ${
                  on
                    ? 'border-teal/60 bg-teal/10 text-txt-1'
                    : 'border-line bg-surface text-txt-2 hover:border-line-2'
                } disabled:cursor-default`}
              >
                {m.fullName ?? m.email}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function FollowupsTab({
  campaignId,
  dispositions,
  initial,
  stages,
  tags,
  canManage,
  onError,
}: {
  campaignId: string;
  dispositions: Disposition[];
  initial: DispositionFollowup[];
  stages: StageOpt[];
  tags: TagOpt[];
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-txt-3">
        Configure email / SMS / task follow-ups per disposition. These override any
        brand-default templates while this campaign is running. Leave a row untouched
        to inherit the brand default. Use <code>{'{{lead.first_name}}'}</code>,{' '}
        <code>{'{{brand.name}}'}</code> tokens.
      </p>
      <div className="space-y-2">
        {dispositions.map((d) => (
          <FollowupRow
            key={d.id}
            campaignId={campaignId}
            disposition={d}
            initial={initial.find((f) => f.dispositionId === d.id) ?? null}
            stages={stages}
            tags={tags}
            canManage={canManage}
            onError={onError}
          />
        ))}
      </div>
    </div>
  );
}

function FollowupRow({
  campaignId,
  disposition,
  initial,
  stages,
  tags,
  canManage,
  onError,
}: {
  campaignId: string | null;
  disposition: Disposition;
  initial: DispositionFollowup | null;
  stages: StageOpt[];
  tags: TagOpt[];
  canManage: boolean;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [sendEmail, setSendEmail] = useState(initial?.sendEmail ?? false);
  const [emailSubject, setEmailSubject] = useState(initial?.emailSubject ?? '');
  const [emailBody, setEmailBody] = useState(initial?.emailBody ?? '');
  const [sendSms, setSendSms] = useState(initial?.sendSms ?? false);
  const [smsBody, setSmsBody] = useState(initial?.smsBody ?? '');
  const [createTask, setCreateTask] = useState(initial?.createTask ?? false);
  const [taskTitle, setTaskTitle] = useState(initial?.taskTitle ?? '');
  const [taskDueMin, setTaskDueMin] = useState(initial?.taskDueMinutes ?? 60);
  const [moveStageId, setMoveStageId] = useState<string | null>(initial?.moveStageId ?? null);
  const [addTagIds, setAddTagIds] = useState<string[]>(initial?.addTagIds ?? []);
  const [hasOverride, setHasOverride] = useState(!!initial);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  const inputCls =
    'w-full rounded-md border border-line bg-canvas px-2 py-1.5 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20';

  function save() {
    if (!canManage) return;
    setSaving(true);
    startTransition(async () => {
      const res = await upsertFollowup({
        campaignId,
        dispositionId: disposition.id,
        enabled,
        sendEmail,
        emailSubject: emailSubject || null,
        emailBody: emailBody || null,
        sendSms,
        smsBody: smsBody || null,
        createTask,
        taskTitle: taskTitle || null,
        taskDueMinutes: createTask ? taskDueMin : null,
        moveStageId,
        addTagIds,
      });
      setSaving(false);
      if (!res.ok) onError(res.error);
      else setHasOverride(true);
    });
  }

  function clear() {
    if (!canManage) return;
    if (!window.confirm('Clear this follow-up override?')) return;
    setSaving(true);
    startTransition(async () => {
      const res = await clearFollowup({ campaignId, dispositionId: disposition.id });
      setSaving(false);
      if (!res.ok) onError(res.error);
      else {
        setHasOverride(false);
        setEnabled(true);
        setSendEmail(false);
        setEmailSubject('');
        setEmailBody('');
        setSendSms(false);
        setSmsBody('');
        setCreateTask(false);
        setTaskTitle('');
        setMoveStageId(null);
        setAddTagIds([]);
      }
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-canvas/40"
      >
        <span className="text-[12.5px] font-medium">{disposition.label}</span>
        <span className="font-mono text-[10.5px] text-txt-3">{disposition.code}</span>
        <span className="ml-auto text-[11px] text-txt-3">
          {hasOverride
            ? `${[
                sendEmail && 'email',
                sendSms && 'sms',
                createTask && 'task',
                moveStageId && 'stage',
                addTagIds.length > 0 && 'tags',
              ]
                .filter(Boolean)
                .join(' + ') || 'configured'}`
            : campaignId
              ? 'inherits brand default'
              : 'not configured'}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-txt-3 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line/60 px-3 py-3">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={!canManage}
              />
              Enabled
            </label>
            {hasOverride && canManage && (
              <button
                type="button"
                onClick={clear}
                className="ml-auto text-[11px] text-hp hover:underline"
              >
                Reset to brand default
              </button>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-line p-2.5">
            <label className="flex items-center gap-2 text-[12px] font-medium">
              <input
                type="checkbox"
                checked={sendEmail}
                onChange={(e) => setSendEmail(e.target.checked)}
                disabled={!canManage}
              />
              Send email
            </label>
            {sendEmail && (
              <>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject (e.g. Thanks for chatting, {{lead.first_name}})"
                  disabled={!canManage}
                  className={inputCls}
                />
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={5}
                  placeholder="Body…"
                  disabled={!canManage}
                  className={inputCls}
                />
              </>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-line p-2.5">
            <label className="flex items-center gap-2 text-[12px] font-medium">
              <input
                type="checkbox"
                checked={sendSms}
                onChange={(e) => setSendSms(e.target.checked)}
                disabled={!canManage}
              />
              Send SMS
            </label>
            {sendSms && (
              <textarea
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                rows={3}
                placeholder="Hi {{lead.first_name}}, thanks for taking my call…"
                disabled={!canManage}
                className={inputCls}
              />
            )}
          </div>

          <div className="space-y-2 rounded-md border border-line p-2.5">
            <label className="flex items-center gap-2 text-[12px] font-medium">
              <input
                type="checkbox"
                checked={createTask}
                onChange={(e) => setCreateTask(e.target.checked)}
                disabled={!canManage}
              />
              Create follow-up task
            </label>
            {createTask && (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Task title"
                  disabled={!canManage}
                  className={`${inputCls} flex-1`}
                />
                <input
                  type="number"
                  min={0}
                  value={taskDueMin}
                  onChange={(e) => setTaskDueMin(parseInt(e.target.value, 10) || 0)}
                  disabled={!canManage}
                  className={`${inputCls} w-28`}
                  title="Due in minutes from now"
                />
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-line p-2.5">
            <div className="text-[12px] font-medium">Lead transitions</div>
            <div className="space-y-1">
              <label className="text-[11px] text-txt-3">Move to stage</label>
              <select
                value={moveStageId ?? ''}
                onChange={(e) => setMoveStageId(e.target.value || null)}
                disabled={!canManage}
                className={inputCls}
              >
                <option value="">— no change —</option>
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-txt-3">Add tags</label>
              {tags.length === 0 ? (
                <div className="text-[11px] text-txt-3">No tags configured.</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const on = addTagIds.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        disabled={!canManage}
                        onClick={() =>
                          setAddTagIds((prev) =>
                            prev.includes(t.id)
                              ? prev.filter((id) => id !== t.id)
                              : [...prev, t.id],
                          )
                        }
                        className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                          on
                            ? 'border-teal bg-teal/15 text-teal'
                            : 'border-line bg-canvas text-txt-2 hover:bg-surface-2'
                        }`}
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {canManage && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-md bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
              >
                {saving ? 'Saving…' : hasOverride ? 'Save override' : 'Create override'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { FollowupRow };

function ActivityTab({
  calls,
  appointments,
}: {
  calls: CallRow[];
  appointments: AppointmentRow[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-txt-3">
          Recent calls
        </div>
        {calls.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px] text-txt-3">No calls yet.</div>
        ) : (
          calls.map((c, i) => (
            <div
              key={c.id}
              className={`flex items-center gap-2 px-3 py-2 text-[12px] ${
                i < calls.length - 1 ? 'border-b border-line/60' : ''
              }`}
            >
              <span className="text-txt-3">{new Date(c.startedAt).toLocaleString()}</span>
              <span className="truncate">{c.leadName ?? '—'}</span>
              <span className="ml-auto font-mono text-[10.5px] text-txt-3">
                {c.disposition ?? '—'}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-txt-3">
          Appointments booked
        </div>
        {appointments.length === 0 ? (
          <div className="px-3 py-8 text-center text-[12px] text-txt-3">
            No appointments yet.
          </div>
        ) : (
          appointments.map((a, i) => (
            <div
              key={a.id}
              className={`flex items-center gap-2 px-3 py-2 text-[12px] ${
                i < appointments.length - 1 ? 'border-b border-line/60' : ''
              }`}
            >
              <span className="text-txt-3">{new Date(a.startsAt).toLocaleString()}</span>
              <span className="truncate">{a.leadName ?? a.title}</span>
              <span className="ml-auto text-[10.5px] text-txt-3">{a.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
