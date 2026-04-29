'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CallRow } from '@/lib/calls';
import type { LeadStage } from '@/lib/leads';
import { LeadDetailDrawer } from '@/components/leads/lead-detail-drawer';
import { DispositionPicker } from '@/components/dialer/disposition-picker';

const DISPOSITION_LABEL: Record<string, string> = {
  connected: 'Connected',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  busy: 'Busy',
  failed: 'Failed',
  wrong_number: 'Wrong number',
  do_not_call: 'DNC',
  callback: 'Callback',
  sale: 'Sale',
  not_interested: 'Not interested',
};

type DirectionFilter = 'all' | 'outbound' | 'inbound';
type DispositionFilter = 'all' | 'needs' | keyof typeof DISPOSITION_LABEL;
type RangeFilter = 'all' | '24h' | '7d' | '30d';

function formatDuration(sec: number | null) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function leadName(c: CallRow) {
  const n = [c.leadFirstName, c.leadLastName].filter(Boolean).join(' ').trim();
  return n || '—';
}

function rangeMs(r: RangeFilter): number | null {
  if (r === '24h') return 24 * 60 * 60 * 1000;
  if (r === '7d') return 7 * 24 * 60 * 60 * 1000;
  if (r === '30d') return 30 * 24 * 60 * 60 * 1000;
  return null;
}

export function CallsList({ stages, calls }: { stages: LeadStage[]; calls: CallRow[] }) {
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [disposition, setDisposition] = useState<DispositionFilter>('all');
  const [range, setRange] = useState<RangeFilter>('all');
  const [search, setSearch] = useState('');
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Single shared <audio> element drives inline playback for any row.
  // activeId = which row's player is "open" (showing scrubber/speed).
  // isPlaying tracks audio.paused so the icon can flip without re-clicking.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setCurrentTime(a.currentTime);
    const onMeta = () => setAudioDuration(Number.isFinite(a.duration) ? a.duration : 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);
    a.addEventListener('timeupdate', onTime);
    a.addEventListener('loadedmetadata', onMeta);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);
    return () => {
      a.removeEventListener('timeupdate', onTime);
      a.removeEventListener('loadedmetadata', onMeta);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
    };
  }, []);

  function play(callId: string) {
    const a = audioRef.current;
    if (!a) return;
    if (activeId === callId) {
      if (a.paused) void a.play().catch(() => undefined);
      else a.pause();
      return;
    }
    setActiveId(callId);
    setCurrentTime(0);
    setAudioDuration(0);
    a.src = `/api/calls/recording/${callId}`;
    a.playbackRate = rate;
    void a.play().catch(() => setActiveId(null));
  }

  function seek(t: number) {
    const a = audioRef.current;
    if (a && Number.isFinite(t)) a.currentTime = t;
    setCurrentTime(t);
  }

  function cycleRate() {
    const rates = [1, 1.25, 1.5, 2];
    const next = rates[(rates.indexOf(rate) + 1) % rates.length] ?? 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  const filtered = useMemo(() => {
    const cutoff = (() => {
      const ms = rangeMs(range);
      return ms === null ? null : Date.now() - ms;
    })();
    const q = search.trim().toLowerCase();
    return calls.filter((c) => {
      if (direction !== 'all' && c.direction !== direction) return false;
      if (disposition === 'needs') {
        if (!c.needsDisposition) return false;
      } else if (disposition !== 'all' && c.disposition !== disposition) {
        return false;
      }
      if (cutoff !== null && new Date(c.startedAt).getTime() < cutoff) return false;
      if (q) {
        const name = leadName(c).toLowerCase();
        const phone = (c.leadPhone ?? '').toLowerCase();
        if (!name.includes(q) && !phone.includes(q)) return false;
      }
      return true;
    });
  }, [calls, direction, disposition, range, search]);

  return (
    <>
      <div className="border-b border-line bg-surface px-6 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line bg-canvas p-0.5">
            {(['all', 'outbound', 'inbound'] as DirectionFilter[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium capitalize ${
                  direction === d ? 'bg-surface text-txt-1 shadow-sm' : 'text-txt-3 hover:text-txt-2'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <select
            value={disposition}
            onChange={(e) => setDisposition(e.target.value as DispositionFilter)}
            className="rounded-lg border border-line bg-canvas px-2.5 py-1 text-[11.5px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          >
            <option value="all">All dispositions</option>
            <option value="needs">Needs disposition</option>
            {Object.entries(DISPOSITION_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <div className="flex rounded-lg border border-line bg-canvas p-0.5">
            {(['all', '24h', '7d', '30d'] as RangeFilter[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ${
                  range === r ? 'bg-surface text-txt-1 shadow-sm' : 'text-txt-3 hover:text-txt-2'
                }`}
              >
                {r === 'all' ? 'All' : r}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search lead name or phone…"
            className="ml-auto w-64 rounded-lg border border-line bg-canvas px-2.5 py-1 text-[12px] outline-none focus:border-teal/60 focus:ring-2 focus:ring-teal/20"
          />
          <span className="font-mono text-[11px] text-txt-3">
            {filtered.length} / {calls.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center p-12">
            <p className="text-[12.5px] text-txt-3">No calls match these filters.</p>
          </div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 border-b border-line bg-canvas text-left">
              <tr className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
                <th className="w-8 px-3 py-2.5"></th>
                <th className="px-3 py-2.5">Lead</th>
                <th className="px-3 py-2.5">Direction</th>
                <th className="px-3 py-2.5">Disposition</th>
                <th className="px-3 py-2.5">Duration</th>
                <th className="px-3 py-2.5">Number</th>
                <th className="px-6 py-2.5 text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const counterparty = c.direction === 'outbound' ? c.toNumber : c.fromNumber;
                const isExpanded = expandedId === c.id;
                const canExpand =
                  c.hasRecording ||
                  Boolean(c.transcript) ||
                  c.transcriptStatus === 'pending' ||
                  c.needsDisposition ||
                  Boolean(c.note);
                return (
                  <RowGroup key={c.id}>
                    <tr
                      className={`border-b border-line/60 transition-colors ${
                        c.leadId || canExpand ? 'hover:bg-surface' : 'opacity-60'
                      }`}
                    >
                      <td className="px-3 py-2.5 text-center">
                        {canExpand && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(isExpanded ? null : c.id);
                            }}
                            className="grid h-5 w-5 place-items-center rounded text-txt-3 hover:bg-canvas hover:text-txt-1"
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            >
                              <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2.5 ${c.leadId ? 'cursor-pointer' : ''}`}
                        onClick={() => c.leadId && setOpenLeadId(c.leadId)}
                      >
                        <span className="font-medium">{leadName(c)}</span>
                        {c.leadPhone && (
                          <span className="ml-2 font-mono text-[11px] text-txt-3">
                            {c.leadPhone}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium capitalize ${
                            c.direction === 'outbound'
                              ? 'bg-teal/15 text-teal'
                              : 'bg-bs/15 text-bs'
                          }`}
                        >
                          {c.direction}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-txt-2">
                        {c.disposition ? (
                          DISPOSITION_LABEL[c.disposition] ?? c.disposition
                        ) : c.needsDisposition ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(isExpanded ? null : c.id);
                            }}
                            className="inline-flex h-[18px] items-center rounded-full bg-hp/15 px-1.5 text-[10.5px] font-medium text-hp hover:bg-hp/25"
                          >
                            Needs disposition
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-txt-2">
                        <RecordingCell
                          call={c}
                          isActive={activeId === c.id}
                          isPlaying={isPlaying}
                          currentTime={currentTime}
                          audioDuration={audioDuration}
                          rate={rate}
                          onPlay={() => play(c.id)}
                          onSeek={seek}
                          onCycleRate={cycleRate}
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11.5px] text-txt-3">
                        {counterparty}
                      </td>
                      <td className="px-6 py-2.5 text-right font-mono text-[11.5px] text-txt-3">
                        {formatWhen(c.startedAt)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-line/60 bg-canvas/40">
                        <td colSpan={7} className="px-6 py-4">
                          <CallDetail call={c} />
                        </td>
                      </tr>
                    )}
                  </RowGroup>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <LeadDetailDrawer
        leadId={openLeadId}
        stages={stages}
        onClose={() => setOpenLeadId(null)}
      />
      <audio ref={audioRef} preload="none" className="hidden" />
    </>
  );
}

// React requires a single parent for sibling <tr>s in JSX; <></> works in
// <tbody> so we just return both rows.
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function CallDetail({ call }: { call: CallRow }) {
  return (
    <div className="space-y-4">
      {call.needsDisposition && (
        <div className="rounded-xl border border-hp/40 bg-hp/5 p-3">
          <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-hp">
            Set disposition
          </div>
          <DispositionPicker callId={call.id} onSaved={() => undefined} />
        </div>
      )}
      {!call.needsDisposition && call.note && (
        <div className="space-y-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
            Note
          </div>
          <div className="whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-[12px] text-txt-1">
            {call.note}
          </div>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-[1fr,1.5fr]">
        <div className="space-y-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
            Recording
          </div>
          {call.hasRecording ? (
            <>
              <audio
                controls
                preload="metadata"
                src={`/api/calls/recording/${call.id}`}
                className="w-full"
              />
              {call.recordingDurationSec !== null && (
                <div className="font-mono text-[10.5px] text-txt-3">
                  {formatDuration(call.recordingDurationSec)}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] text-txt-3">
              No recording yet.
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-txt-3">
            Transcript
          </div>
          <TranscriptPanel
            status={call.transcriptStatus}
            text={call.transcript}
            hasRecording={call.hasRecording}
          />
        </div>
      </div>
    </div>
  );
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type RecordingCellProps = {
  call: CallRow;
  isActive: boolean;
  isPlaying: boolean;
  currentTime: number;
  audioDuration: number;
  rate: number;
  onPlay: () => void;
  onSeek: (t: number) => void;
  onCycleRate: () => void;
};

function RecordingCell({
  call,
  isActive,
  isPlaying,
  currentTime,
  audioDuration,
  rate,
  onPlay,
  onSeek,
  onCycleRate,
}: RecordingCellProps) {
  if (!call.hasRecording) {
    return <span>{formatDuration(call.durationSec ?? call.recordingDurationSec)}</span>;
  }
  const total = isActive && audioDuration > 0
    ? audioDuration
    : call.recordingDurationSec ?? call.durationSec ?? 0;
  const downloadHref = `/api/calls/recording/${call.id}`;
  const downloadName = `call-${call.id.slice(0, 8)}.mp3`;
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPlay();
        }}
        aria-label={isActive && isPlaying ? 'Pause' : 'Play'}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-canvas text-txt-2 hover:border-teal/60 hover:text-teal"
      >
        {isActive && isPlaying ? (
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <input
        type="range"
        min={0}
        max={total || 1}
        step={0.1}
        value={isActive ? currentTime : 0}
        disabled={!isActive}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Seek"
        className="h-1 w-32 cursor-pointer accent-teal disabled:cursor-default disabled:opacity-50"
      />
      <span className="font-mono text-[10.5px] text-txt-3">
        {isActive ? `${fmtTime(currentTime)} / ${fmtTime(total)}` : formatDuration(total || null)}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCycleRate();
        }}
        aria-label="Playback speed"
        className="rounded border border-line bg-canvas px-1.5 py-0.5 text-[10.5px] font-medium text-txt-2 hover:border-teal/60 hover:text-teal"
      >
        {rate}×
      </button>
      <a
        href={downloadHref}
        download={downloadName}
        onClick={(e) => e.stopPropagation()}
        aria-label="Download recording"
        className="grid h-5 w-5 shrink-0 place-items-center rounded text-txt-3 hover:text-teal"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      </a>
    </div>
  );
}

function TranscriptPanel({
  status,
  text,
  hasRecording,
}: {
  status: CallRow['transcriptStatus'];
  text: string | null;
  hasRecording: boolean;
}) {
  if (text) {
    return (
      <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-3 py-2 text-[12px] leading-relaxed text-txt-1">
        {text}
      </div>
    );
  }
  let label = '—';
  if (!hasRecording) label = 'No recording yet.';
  else if (status === 'pending') label = 'Transcribing… refresh in a moment.';
  else if (status === 'failed') label = 'Transcription failed.';
  else if (status === 'skipped')
    label = 'Transcription skipped — set OPENAI_API_KEY to enable.';
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] text-txt-3">
      {label}
    </div>
  );
}
