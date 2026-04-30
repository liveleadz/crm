'use client';

// Editor header for /workflows/[id]: back link, inline-editable name,
// Standard|Visual toggle, save state badge, enabled toggle.

import Link from 'next/link';
import { useEffect, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type EditorView = 'standard' | 'visual' | 'runs';

type Props = {
  initialName: string;
  view: EditorView;
  onViewChange: (v: EditorView) => void;
  saveState: SaveState;
  enabled: boolean;
  onToggleEnabled: () => void;
  onRename: (name: string) => void;
};

export function HeaderBar({
  initialName,
  view,
  onViewChange,
  saveState,
  enabled,
  onToggleEnabled,
  onRename,
}: Props) {
  const [name, setName] = useState(initialName);
  useEffect(() => setName(initialName), [initialName]);

  function commitName() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== initialName) onRename(trimmed);
    else setName(initialName);
  }

  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
      <div className="flex items-center gap-3">
        <Link
          href="/workflows"
          className="text-[12.5px] text-txt-3 hover:text-txt-1"
        >
          ← Back
        </Link>
        <div className="h-4 w-px bg-line" />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setName(initialName);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="rounded-md border border-transparent bg-transparent px-2 py-1 text-[14px] font-semibold outline-none hover:border-line focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
        />
      </div>

      <div className="flex items-center gap-3">
        <SaveBadge state={saveState} />

        <div className="flex rounded-lg border border-line bg-canvas p-0.5">
          {(['standard', 'visual', 'runs'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onViewChange(k)}
              className={`rounded-md px-3 py-1 text-[12px] font-medium capitalize transition-colors ${
                view === k ? 'bg-surface text-txt-1 shadow-sm' : 'text-txt-3 hover:text-txt-1'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-txt-3">{enabled ? 'Published' : 'Draft'}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onToggleEnabled}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              enabled ? 'bg-teal' : 'bg-line'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    </header>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const map = {
    idle: { label: 'Saved', className: 'text-txt-3' },
    saving: { label: 'Saving…', className: 'text-txt-3' },
    saved: { label: 'Saved', className: 'text-emerald-600 dark:text-emerald-400' },
    error: { label: 'Save failed', className: 'text-hp' },
  } as const;
  const cur = map[state];
  return <span className={`text-[11.5px] ${cur.className}`}>{cur.label}</span>;
}
