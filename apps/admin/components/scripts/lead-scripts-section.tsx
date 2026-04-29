'use client';

import { useEffect, useMemo, useState } from 'react';
import { getBrandScripts } from '@/app/actions/scripts';
import { renderScript, type ScriptKind, type ScriptRow, type ScriptVars } from '@/lib/scripts';

const KIND_LABEL: Record<ScriptKind, string> = {
  call: 'Call',
  sms: 'SMS',
  email: 'Email',
};

export type LeadScriptVars = {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  stageName: string | null;
};

function buildVars(lead: LeadScriptVars, brandName: string | null): ScriptVars {
  const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || null;
  return {
    first_name: lead.firstName,
    last_name: lead.lastName,
    full_name: fullName,
    phone: lead.phone,
    email: lead.email,
    stage: lead.stageName,
    brand_name: brandName,
  };
}

export function LeadScriptsSection({ lead }: { lead: LeadScriptVars }) {
  const [kind, setKind] = useState<ScriptKind>('call');
  const [scripts, setScripts] = useState<ScriptRow[] | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getBrandScripts().then((res) => {
      if (!active) return;
      setScripts(res.scripts);
      setBrandName(res.brandName);
    });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(
    () => (scripts ?? []).filter((s) => s.kind === kind),
    [scripts, kind],
  );

  const vars = useMemo(() => buildVars(lead, brandName), [lead, brandName]);

  async function copy(s: ScriptRow) {
    const body = renderScript(s.body, vars);
    const text =
      s.kind === 'email' && s.subject
        ? `Subject: ${renderScript(s.subject, vars)}\n\n${body}`
        : body;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(s.id);
      setTimeout(() => {
        setCopiedId((curr) => (curr === s.id ? null : curr));
      }, 1500);
    } catch {
      // Clipboard may be unavailable in some browsers / contexts; ignore.
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-txt-3">
          Scripts
        </h4>
        <div className="flex gap-1 rounded-lg border border-line bg-canvas p-0.5">
          {(['call', 'sms', 'email'] as ScriptKind[]).map((k) => {
            const on = k === kind;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setOpenId(null);
                }}
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                  on ? 'bg-surface text-txt' : 'text-txt-3 hover:text-txt'
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
      </div>

      {scripts === null ? (
        <p className="text-[12px] text-txt-3">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-[12px] text-txt-3">
          No {KIND_LABEL[kind].toLowerCase()} scripts yet. Create some on the Scripts page.
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => {
            const open = s.id === openId;
            const renderedBody = renderScript(s.body, vars);
            const renderedSubject =
              s.kind === 'email' && s.subject ? renderScript(s.subject, vars) : null;
            return (
              <li key={s.id} className="overflow-hidden rounded-lg border border-line bg-canvas">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : s.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface/40"
                >
                  <span className="flex-1 truncate text-[12.5px] font-medium">{s.name}</span>
                  {s.description && (
                    <span className="hidden truncate text-[11px] text-txt-3 sm:inline">
                      {s.description}
                    </span>
                  )}
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className={`text-txt-3 transition-transform ${open ? 'rotate-180' : ''}`}
                  >
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" />
                  </svg>
                </button>
                {open && (
                  <div className="space-y-2 border-t border-line/60 bg-surface/40 p-3">
                    {renderedSubject && (
                      <div className="text-[12px]">
                        <span className="text-txt-3">Subject: </span>
                        <span className="font-medium">{renderedSubject}</span>
                      </div>
                    )}
                    <div className="whitespace-pre-wrap text-[12.5px] leading-snug text-txt">
                      {renderedBody || <span className="text-txt-3">Empty body</span>}
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => copy(s)}
                        className="rounded-md border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-txt-2 hover:bg-canvas"
                      >
                        {copiedId === s.id ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
