'use client';

// Inline script reader rendered inside the in-call popup so the agent
// can read straight from the active call without leaving the page.
// Loads the brand's `call` scripts on first mount, renders each one
// collapsed by default with title + 1-line description, and expands
// to show the rendered body (with {{first_name}}, {{phone}} etc.
// substituted from the active call's lead) on click. Section-based
// scripts render each section as its own sub-card so the agent can
// see the conversational tree at a glance.

import { useEffect, useMemo, useState } from 'react';
import { getBrandScripts } from '@/app/actions/scripts';
import { renderScript, type ScriptRow, type ScriptVars } from '@/lib/scripts';

export type InCallScriptsLead = {
  leadName: string | null;
  phone: string | null;
};

function buildVars(lead: InCallScriptsLead, brandName: string | null): ScriptVars {
  const full = lead.leadName?.trim() || null;
  const parts = full ? full.split(/\s+/) : [];
  const first = parts[0] ?? null;
  const last = parts.length > 1 ? parts.slice(1).join(' ') : null;
  return {
    first_name: first,
    last_name: last,
    full_name: full,
    phone: lead.phone,
    email: null,
    stage: null,
    brand_name: brandName,
  };
}

export function InCallScripts({ lead }: { lead: InCallScriptsLead }) {
  const [scripts, setScripts] = useState<ScriptRow[] | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch once when the panel mounts. The popup unmounts the panel
  // entirely when the agent closes it, so re-opening will re-fetch
  // (cheap action, single Supabase query).
  useEffect(() => {
    let active = true;
    getBrandScripts('call')
      .then((res) => {
        if (!active) return;
        setScripts(res.scripts);
        setBrandName(res.brandName);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Failed to load scripts');
        setScripts([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const vars = useMemo(() => buildVars(lead, brandName), [lead, brandName]);

  if (error) {
    return <p className="text-[11.5px] text-hp">{error}</p>;
  }
  if (scripts === null) {
    return <p className="text-[11.5px] text-txt-3">Loading scripts…</p>;
  }
  if (scripts.length === 0) {
    return (
      <p className="text-[11.5px] text-txt-3">
        No call scripts yet. Create one on the Scripts page.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {scripts.map((s) => {
        const open = s.id === openId;
        return (
          <li
            key={s.id}
            className="overflow-hidden rounded-md border border-line bg-canvas"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : s.id)}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2/60"
            >
              <span className="flex-1 truncate text-[12px] font-medium text-txt-1">
                {s.name}
              </span>
              {s.description && !open && (
                <span className="hidden truncate text-[10.5px] text-txt-3 sm:inline">
                  {s.description}
                </span>
              )}
              <svg
                width="10"
                height="10"
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
              <div className="space-y-2 border-t border-line/60 bg-surface/40 px-2.5 py-2">
                {s.description && (
                  <p className="text-[10.5px] italic text-txt-3">{s.description}</p>
                )}
                {s.sections && s.sections.length > 0 ? (
                  s.sections.map((sec, i) => (
                    <div
                      key={sec.id}
                      className="rounded border border-line/60 bg-canvas/60 p-2"
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-txt-3">
                        <span className="grid h-4 w-4 place-items-center rounded-full bg-teal/15 text-[9px] text-teal">
                          {i + 1}
                        </span>
                        {sec.title}
                      </div>
                      <div className="whitespace-pre-wrap text-[11.5px] leading-snug text-txt-1">
                        {renderScript(sec.body, vars) || (
                          <span className="text-txt-3">Empty section</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="whitespace-pre-wrap text-[11.5px] leading-snug text-txt-1">
                    {renderScript(s.body, vars) || (
                      <span className="text-txt-3">Empty body</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
