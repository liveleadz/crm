'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { importLeads } from '@/app/actions/leads';
import { createCustomField } from '@/app/actions/lists';
import {
  applyMapping,
  autoMapHeaders,
  isCustomTarget,
  LEAD_COLUMNS,
  type FieldMapping,
  type MappingTarget,
} from '@/lib/leads-import';
import type { LeadStage } from '@/lib/leads';
import type { CustomField } from '@/lib/lists';

type Step = 'upload' | 'map' | 'preview' | 'done';

type Result = {
  inserted: number;
  invalid: number;
  skippedDuplicate: number;
  errors: string[];
  listId: string | null;
  listName: string | null;
};

export function ImportWizard({
  stages,
  initialCustomFields,
}: {
  stages: LeadStage[];
  initialCustomFields: CustomField[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('upload');
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<FieldMapping>({});
  const [listName, setListName] = useState<string>('');
  const [customFields, setCustomFields] = useState<CustomField[]>(initialCustomFields);
  const sortedStages = [...stages].sort((a, b) => a.position - b.position);
  const [stageId, setStageId] = useState<string>(sortedStages[0]?.id ?? '');
  const [skipDedup, setSkipDedup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [, startTransition] = useTransition();
  const [importing, setImporting] = useState(false);
  // Header currently being renamed via the inline "+ New custom field" input.
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function parseFile(file: File) {
    setError(null);
    setFileName(file.name);
    // Default the list name to the filename without extension.
    setListName((prev) => prev || file.name.replace(/\.[^.]+$/, '').slice(0, 80));
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        const cols = (results.meta.fields ?? []).filter((c) => c.length > 0);
        if (cols.length === 0) {
          setError('No headers found. The first row must contain column names.');
          return;
        }
        if (results.data.length === 0) {
          setError('No data rows found.');
          return;
        }
        setHeaders(cols);
        setRows(results.data);
        setMapping(autoMapHeaders(cols));
        setStep('map');
      },
      error: (err) => setError(`Parse failed: ${err.message}`),
    });
  }

  function changeMap(header: string, target: MappingTarget) {
    setMapping((m) => ({ ...m, [header]: target }));
  }

  // Bulk-flip every "custom field (header key)" entry to skip — useful
  // for wide CSVs where the user only wants the recognized lead
  // columns. Lead-column and explicit `custom:<slug>` mappings are
  // preserved.
  function skipAllCustom() {
    setMapping((m) => {
      const next: FieldMapping = { ...m };
      for (const [k, v] of Object.entries(next)) {
        if (v === '__custom__') next[k] = '__skip__';
      }
      return next;
    });
  }

  // Open the inline "+ New custom field" input for a given header.
  function openCreate(header: string) {
    setCreatingFor(header);
    setNewFieldLabel(header);
  }

  function cancelCreate() {
    setCreatingFor(null);
    setNewFieldLabel('');
  }

  async function commitCreate(header: string) {
    const label = newFieldLabel.trim();
    if (!label) return;
    setCreating(true);
    const res = await createCustomField({ label });
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    // Add to local cache (avoid duplicates if upsert returned an existing one).
    setCustomFields((prev) =>
      prev.some((f) => f.id === res.id)
        ? prev
        : [...prev, { id: res.id, key: res.key, label: res.label }],
    );
    changeMap(header, `custom:${res.key}` as MappingTarget);
    cancelCreate();
  }

  const previewRows = useMemo(() => {
    if (step !== 'preview' && step !== 'map') return [];
    return rows.slice(0, 5).map((r) => applyMapping(r, mapping));
  }, [rows, mapping, step]);

  const validCount = useMemo(
    () => rows.filter((r) => applyMapping(r, mapping).errors.length === 0).length,
    [rows, mapping],
  );

  function commit() {
    setError(null);
    if (!listName.trim()) {
      setError('Please give this list a name.');
      return;
    }
    setImporting(true);
    startTransition(async () => {
      const res = await importLeads({
        rows,
        mapping,
        stageId: stageId || null,
        listName: listName.trim(),
        skipDedup,
      });
      setImporting(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({
        inserted: res.inserted,
        invalid: res.invalid,
        skippedDuplicate: res.skippedDuplicate,
        errors: res.errors,
        listId: res.listId,
        listName: res.listName ?? null,
      });
      setStep('done');
      // No router.refresh() — the action's revalidatePath('/leads')
      // already invalidates the leads route cache, and refreshing the
      // current /pipelines/import page would needlessly re-run its
      // server loaders just to render the same wizard shell.
    });
  }

  function reset() {
    setStep('upload');
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setListName('');
    setResult(null);
    setError(null);
    cancelCreate();
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Stepper current={step} />

      {error && (
        <div className="rounded-lg border border-hp/40 bg-hp/10 px-3 py-2 text-[12px] text-hp">
          {error}
        </div>
      )}

      {step === 'upload' && (
        <div className="rounded-2xl border border-line bg-surface p-8">
          <div className="grid place-items-center rounded-xl border-2 border-dashed border-line-2 p-12 text-center">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mb-3 text-txt-3"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <h3 className="mb-1 text-[14px] font-semibold">Drop a CSV file here</h3>
            <p className="mb-4 text-[12px] text-txt-3">
              First row must be column headers. UTF-8 encoded.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) parseFile(f);
              }}
              className="hidden"
              id="csv-file"
            />
            <label
              htmlFor="csv-file"
              className="cursor-pointer rounded-lg bg-teal px-4 py-2 text-[12.5px] font-medium text-white hover:bg-teal/90"
            >
              Choose file
            </label>
            {fileName && (
              <p className="mt-3 text-[11.5px] text-txt-3">Selected: {fileName}</p>
            )}
          </div>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <MapSummary
            mapping={mapping}
            headers={headers}
            validCount={validCount}
            totalRows={rows.length}
            onSkipCustom={skipAllCustom}
          />
          <div className="rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <h3 className="text-[13.5px] font-semibold">Map fields</h3>
                <p className="text-[11.5px] text-txt-3">
                  {fileName} · {rows.length.toLocaleString()} rows · {headers.length} columns ·
                  required: <span className="font-medium text-txt-2">at least one of</span>{' '}
                  name, email, or phone
                </p>
              </div>
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] text-txt-2 hover:bg-canvas/50"
              >
                Use different file
              </button>
            </div>
            {/* Grid layout (not a table) so the three columns have
                fixed widths and the dropdown column is always visible
                without horizontal scroll, regardless of how long the
                CSV header or sample values are. */}
            <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px] gap-4 border-b border-line bg-canvas px-5 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3 md:grid">
              <span>CSV header</span>
              <span>Sample</span>
              <span>Maps to</span>
            </div>
            <div>
              {headers.map((h) => {
                const sample = rows[0]?.[h] ?? '';
                const value = mapping[h] ?? '__skip__';
                const isCreating = creatingFor === h;
                return (
                  <div
                    key={h}
                    className="grid grid-cols-1 gap-2 border-b border-line px-5 py-2.5 text-[12.5px] last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px] md:gap-4 md:py-2"
                  >
                    <div className="min-w-0 truncate font-medium" title={h}>
                      {h}
                    </div>
                    <div className="min-w-0 truncate text-txt-3" title={sample}>
                      {sample || '—'}
                    </div>
                    <div className="min-w-0">
                      {isCreating ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="text"
                            autoFocus
                            value={newFieldLabel}
                            onChange={(e) => setNewFieldLabel(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitCreate(h);
                              } else if (e.key === 'Escape') {
                                cancelCreate();
                              }
                            }}
                            placeholder="Field name (e.g. Source Campaign)"
                            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-1 text-[12px] outline-none focus:border-teal/60"
                          />
                          <button
                            type="button"
                            onClick={() => commitCreate(h)}
                            disabled={creating || !newFieldLabel.trim()}
                            className="rounded-lg bg-teal px-2.5 py-1 text-[11.5px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
                          >
                            {creating ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelCreate}
                            className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11.5px] text-txt-3 hover:bg-canvas/50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <select
                          value={value}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === '__new_custom__') {
                              openCreate(h);
                              return;
                            }
                            changeMap(h, v as MappingTarget);
                          }}
                          className="w-full rounded-lg border border-line bg-canvas px-2 py-1 text-[12px] outline-none focus:border-teal/60"
                        >
                          <option value="__skip__">— Skip —</option>
                          <option value="__custom__">Custom field (header key)</option>
                          <optgroup label="Lead column">
                            {LEAD_COLUMNS.map((c) => (
                              <option key={c.value} value={c.value}>
                                {c.label}
                              </option>
                            ))}
                          </optgroup>
                          {customFields.length > 0 && (
                            <optgroup label="Custom fields">
                              {customFields.map((f) => (
                                <option key={f.id} value={`custom:${f.key}`}>
                                  {f.label}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <option value="__new_custom__">+ New custom field…</option>
                        </select>
                      )}
                      {!isCreating && isCustomTarget(value) && (
                        <span className="mt-1 block text-[10.5px] text-txt-3">
                          stored as <code className="font-mono">{value.slice(7)}</code>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5">
            <h4 className="mb-3 text-[12.5px] font-semibold">Import options</h4>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                  Smart list name
                </div>
                <input
                  type="text"
                  value={listName}
                  onChange={(e) => setListName(e.target.value)}
                  placeholder="e.g. FB Lead Form Q1"
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                  Initial stage
                </div>
                <select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] outline-none focus:border-teal/60"
                >
                  <option value="">No stage</option>
                  {sortedStages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex cursor-pointer items-center gap-2 self-end">
                <input
                  type="checkbox"
                  checked={!skipDedup}
                  onChange={(e) => setSkipDedup(!e.target.checked)}
                  className="h-4 w-4 rounded border-line accent-teal"
                />
                <span className="text-[12px]">
                  Skip duplicates (existing phone/email in this brand)
                </span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-3">
            <span className="text-[12px] text-txt-3">
              {validCount.toLocaleString()} of {rows.length.toLocaleString()} rows valid in
              this mapping.
            </span>
            <button
              type="button"
              onClick={() => setStep('preview')}
              disabled={validCount === 0 || !listName.trim()}
              className="rounded-lg bg-teal px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
            >
              Preview →
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div>
                <h3 className="text-[13.5px] font-semibold">Preview</h3>
                <p className="text-[11.5px] text-txt-3">
                  Will save to list <span className="font-semibold text-txt-1">{listName}</span> ·{' '}
                  {validCount.toLocaleString()} of {rows.length.toLocaleString()} rows.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep('map')}
                className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] text-txt-2 hover:bg-canvas/50"
              >
                ← Edit mapping
              </button>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line bg-canvas text-left text-[10.5px] uppercase tracking-wide text-txt-3">
                  <th className="px-5 py-2 font-semibold">First</th>
                  <th className="px-5 py-2 font-semibold">Last</th>
                  <th className="px-5 py-2 font-semibold">Email</th>
                  <th className="px-5 py-2 font-semibold">Phone</th>
                  <th className="px-5 py-2 font-semibold">Location</th>
                  <th className="px-5 py-2 font-semibold">Custom</th>
                  <th className="px-5 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((p, i) => {
                  const blocked = p.errors.length > 0;
                  const warned = !blocked && p.warnings.length > 0;
                  return (
                    <tr key={i} className="border-b border-line last:border-b-0">
                      <td className="px-5 py-2 text-txt-2">{p.first_name ?? '—'}</td>
                      <td className="px-5 py-2 text-txt-2">{p.last_name ?? '—'}</td>
                      <td className="px-5 py-2 text-txt-2">{p.email ?? '—'}</td>
                      <td className="px-5 py-2 text-txt-2">{p.phone ?? '—'}</td>
                      <td className="px-5 py-2 text-txt-3">
                        {[p.city, p.state, p.zip].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-5 py-2 text-txt-3">
                        {Object.keys(p.custom).length > 0
                          ? `${Object.keys(p.custom).length} field${Object.keys(p.custom).length === 1 ? '' : 's'}`
                          : '—'}
                      </td>
                      <td className="px-5 py-2">
                        {blocked ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-hp">
                            <span className="h-1.5 w-1.5 rounded-full bg-hp" /> {p.errors[0]}
                          </span>
                        ) : warned ? (
                          <span
                            className="inline-flex items-center gap-1.5 text-[11px] text-vl"
                            title={p.warnings.join(' · ')}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-vl" /> {p.warnings[0]}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] text-ll">
                            <span className="h-1.5 w-1.5 rounded-full bg-ll" /> Ready
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={importing}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] text-txt-2 hover:bg-canvas disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={commit}
              disabled={importing || validCount === 0}
              className="rounded-lg bg-teal px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal/90 disabled:opacity-50"
            >
              {importing
                ? 'Importing…'
                : `Import ${validCount.toLocaleString()} lead${validCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="rounded-2xl border border-line bg-surface p-8">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-ll/15">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-ll">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h3 className="text-[15px] font-semibold">Import complete</h3>
          <p className="mt-1 text-[12.5px] text-txt-2">
            {result.inserted.toLocaleString()} lead
            {result.inserted === 1 ? '' : 's'} added
            {result.listName ? ` to “${result.listName}”` : ''}.
            {result.skippedDuplicate > 0 &&
              ` ${result.skippedDuplicate.toLocaleString()} duplicate${result.skippedDuplicate === 1 ? '' : 's'} skipped.`}
            {result.invalid > 0 &&
              ` ${result.invalid.toLocaleString()} invalid row${result.invalid === 1 ? '' : 's'}.`}
          </p>
          {result.errors.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[11.5px] text-txt-3">
                Show first {result.errors.length} error{result.errors.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[11.5px] text-hp">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-txt-2 hover:bg-canvas"
            >
              Import more
            </button>
            <a
              href={result.listId ? `/leads?list=${result.listId}` : '/leads'}
              className="rounded-lg bg-teal px-4 py-1.5 text-[12.5px] font-medium text-white hover:bg-teal/90"
            >
              View list →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'upload', label: '1 · Upload' },
    { key: 'map', label: '2 · Map fields' },
    { key: 'preview', label: '3 · Preview' },
    { key: 'done', label: '4 · Done' },
  ];
  const currentIdx = steps.findIndex((s) => s.key === current);
  return (
    <div className="flex items-center gap-2 text-[11.5px]">
      {steps.map((s, i) => {
        const active = i <= currentIdx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 ${
                active ? 'bg-teal/15 font-medium text-teal' : 'bg-canvas text-txt-3'
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span
                className={`h-px w-6 ${active && i < currentIdx ? 'bg-teal/40' : 'bg-line'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// At-a-glance summary of the current mapping. Helps the agent see what's
// being captured before they hit Preview without having to scan every row.
function MapSummary({
  mapping,
  headers,
  validCount,
  totalRows,
  onSkipCustom,
}: {
  mapping: FieldMapping;
  headers: string[];
  validCount: number;
  totalRows: number;
  onSkipCustom: () => void;
}) {
  let mapped = 0;
  let custom = 0;
  let skipped = 0;
  for (const h of headers) {
    const t = mapping[h] ?? '__skip__';
    if (t === '__skip__') skipped += 1;
    else if (t === '__custom__' || (typeof t === 'string' && t.startsWith('custom:'))) custom += 1;
    else mapped += 1;
  }
  const ready = validCount === totalRows;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-5 py-3">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
        Mapping
      </span>
      <Pill tone="teal">{mapped} → lead column</Pill>
      <Pill tone="neutral">{custom} → custom</Pill>
      <Pill tone="muted">{skipped} skipped</Pill>
      {custom > 0 && (
        <button
          type="button"
          onClick={onSkipCustom}
          className="rounded-full border border-line bg-canvas px-2 py-0.5 text-[11px] font-medium text-txt-2 hover:border-line-2 hover:text-txt-1"
          title="Set every header-key custom field to Skip — keeps explicit mappings and lead columns"
        >
          Skip {custom} custom
        </button>
      )}
      <span className="ml-auto text-[12px]">
        <span className={ready ? 'text-teal' : 'text-txt-2'}>
          {validCount.toLocaleString()} of {totalRows.toLocaleString()}
        </span>{' '}
        <span className="text-txt-3">rows ready to import</span>
      </span>
    </div>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'teal' | 'neutral' | 'muted';
}) {
  const cls =
    tone === 'teal'
      ? 'bg-teal/15 text-teal ring-teal/30'
      : tone === 'neutral'
        ? 'bg-canvas text-txt-2 ring-line'
        : 'bg-canvas text-txt-3 ring-line';
  return (
    <span className={`inline-flex h-[20px] items-center rounded-full px-2 text-[11px] font-medium ring-1 ${cls}`}>
      {children}
    </span>
  );
}
