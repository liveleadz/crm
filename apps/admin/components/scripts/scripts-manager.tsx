'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Route } from 'next';
import {
  createScript,
  deleteScript,
  updateScript,
} from '@/app/actions/scripts';
import {
  SCRIPT_TOKENS,
  renderScript,
  type ScriptKind,
  type ScriptRow,
} from '@/lib/scripts';

const KIND_LABEL: Record<ScriptKind, string> = {
  call: 'Call',
  sms: 'SMS',
  email: 'Email',
};

const SAMPLE_VARS = {
  first_name: 'Alex',
  last_name: 'Morgan',
  full_name: 'Alex Morgan',
  phone: '(415) 555-0142',
  email: 'alex@example.com',
  stage: 'New',
  brand_name: 'Your Brand',
};

export function ScriptsManager({
  activeKind,
  scripts,
}: {
  activeKind: ScriptKind;
  scripts: ScriptRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [list, setList] = useState<ScriptRow[]>(scripts);
  const [selectedId, setSelectedId] = useState<string | null>(scripts[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync when server-side data changes (e.g. after switching tab).
  useEffect(() => {
    setList(scripts);
    setSelectedId((curr) => {
      if (curr && scripts.some((s) => s.id === curr)) return curr;
      return scripts[0]?.id ?? null;
    });
  }, [scripts]);

  const selected = useMemo(
    () => list.find((s) => s.id === selectedId) ?? null,
    [list, selectedId],
  );

  function switchKind(kind: ScriptKind) {
    router.replace(`${pathname}?kind=${kind}` as Route);
  }

  function patchLocal(id: string, p: Partial<ScriptRow>) {
    setList((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)));
  }

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await createScript({
        kind: activeKind,
        name: `Untitled ${KIND_LABEL[activeKind]}`,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Optimistic insert; server revalidate will merge fully on next nav.
      const placeholder: ScriptRow = {
        id: res.id,
        brandId: '',
        kind: activeKind,
        name: `Untitled ${KIND_LABEL[activeKind]}`,
        description: null,
        subject: null,
        body: '',
        updatedAt: new Date().toISOString(),
      };
      setList((prev) => [placeholder, ...prev]);
      setSelectedId(res.id);
    });
  }

  function persist(
    id: string,
    patch: { name?: string; description?: string | null; subject?: string | null; body?: string },
  ) {
    setError(null);
    startTransition(async () => {
      const res = await updateScript(id, patch);
      if (!res.ok) setError(res.error);
    });
  }

  function remove(id: string) {
    if (!window.confirm('Delete this script?')) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteScript(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setList((prev) => prev.filter((s) => s.id !== id));
      setSelectedId((curr) => (curr === id ? null : curr));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {(['call', 'sms', 'email'] as ScriptKind[]).map((k) => {
            const on = k === activeKind;
            return (
              <button
                key={k}
                type="button"
                onClick={() => switchKind(k)}
                className={`rounded px-3 py-1 text-[12px] font-medium ${
                  on ? 'bg-canvas text-txt' : 'text-txt-3 hover:text-txt'
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={add}
          className="rounded-lg bg-teal px-3 py-1.5 text-[12px] font-medium text-white hover:bg-teal/90"
        >
          + New {KIND_LABEL[activeKind].toLowerCase()} script
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}

      <div className="grid grid-cols-[260px_1fr] gap-4">
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {list.length === 0 ? (
            <div className="px-3 py-8 text-center text-[12px] text-txt-3">
              No {KIND_LABEL[activeKind].toLowerCase()} scripts yet.
            </div>
          ) : (
            <ul>
              {list.map((s) => {
                const on = s.id === selectedId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(s.id)}
                      className={`flex w-full flex-col items-start gap-0.5 border-b border-line/60 px-3 py-2.5 text-left last:border-b-0 ${
                        on ? 'bg-canvas' : 'hover:bg-canvas/60'
                      }`}
                    >
                      <span className="truncate text-[12.5px] font-medium">{s.name}</span>
                      <span className="line-clamp-1 text-[11px] text-txt-3">
                        {s.description || s.subject || s.body.slice(0, 60) || '—'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          {selected ? (
            <ScriptEditor
              key={selected.id}
              script={selected}
              onPatch={(p) => {
                patchLocal(selected.id, p);
                persist(selected.id, p);
              }}
              onDelete={() => remove(selected.id)}
            />
          ) : (
            <div className="grid h-[300px] place-items-center text-[12px] text-txt-3">
              Select a script on the left, or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScriptEditor({
  script,
  onPatch,
  onDelete,
}: {
  script: ScriptRow;
  onPatch: (p: { name?: string; description?: string | null; subject?: string | null; body?: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(script.name);
  const [description, setDescription] = useState(script.description ?? '');
  const [subject, setSubject] = useState(script.subject ?? '');
  const [body, setBody] = useState(script.body);
  const [showPreview, setShowPreview] = useState(false);

  function insertToken(token: string) {
    const ta = document.getElementById(`script-body-${script.id}`) as HTMLTextAreaElement | null;
    const insert = `{{${token}}}`;
    if (!ta) {
      const next = body + insert;
      setBody(next);
      onPatch({ body: next });
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    const next = body.slice(0, start) + insert + body.slice(end);
    setBody(next);
    onPatch({ body: next });
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + insert.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  const rendered = renderScript(body, SAMPLE_VARS);
  const renderedSubject =
    script.kind === 'email' ? renderScript(subject, SAMPLE_VARS) : '';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-canvas/40 px-3 py-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const v = name.trim();
            if (v && v !== script.name) onPatch({ name: v });
            else if (!v) setName(script.name);
          }}
          className="flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[13px] font-semibold hover:border-line focus:border-teal/60 focus:bg-surface focus:outline-none focus:ring-2 focus:ring-teal/20"
        />
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="rounded-md border border-line px-2 py-1 text-[11.5px] text-txt-2 hover:bg-canvas"
        >
          {showPreview ? 'Edit' : 'Preview'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete script"
          className="grid h-7 w-7 place-items-center rounded-md text-txt-3 hover:bg-hp/10 hover:text-hp"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="space-y-3 p-3">
        <div>
          <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => onPatch({ description: description.trim() || null })}
            placeholder="Optional internal note"
            className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
        </div>

        {script.kind === 'email' && (
          <div>
            <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => onPatch({ subject: subject.trim() || null })}
              placeholder="Email subject — supports {{first_name}}"
              className="w-full rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            />
            {showPreview && renderedSubject && (
              <p className="mt-1 text-[11.5px] text-txt-3">
                Preview: <span className="text-txt-2">{renderedSubject}</span>
              </p>
            )}
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
              Body
            </label>
            <div className="flex flex-wrap gap-1">
              {SCRIPT_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => insertToken(t)}
                  className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-[10.5px] text-txt-2 hover:bg-surface"
                >
                  {`{{${t}}}`}
                </button>
              ))}
            </div>
          </div>
          {showPreview ? (
            <div className="min-h-[260px] whitespace-pre-wrap rounded-md border border-line bg-canvas px-3 py-2 text-[12.5px] text-txt">
              {rendered || <span className="text-txt-3">Empty</span>}
            </div>
          ) : (
            <textarea
              id={`script-body-${script.id}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onBlur={() => onPatch({ body })}
              placeholder={
                script.kind === 'sms'
                  ? 'Hi {{first_name}}, this is {{brand_name}}…'
                  : script.kind === 'email'
                  ? 'Hi {{first_name}},\n\nWanted to follow up on…'
                  : 'Hi {{first_name}}, this is — calling about…'
              }
              className="min-h-[260px] w-full rounded-md border border-line bg-canvas px-3 py-2 font-mono text-[12.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
            />
          )}
          {script.kind === 'sms' && (
            <p className="mt-1 text-[11px] text-txt-3">
              {body.length} characters · {Math.max(1, Math.ceil(body.length / 160))} segment(s)
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
