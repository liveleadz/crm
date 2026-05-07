import Link from 'next/link';
import type { RecentCall } from '@/lib/dashboard';
import { RecordingButton } from '@/components/calls/recording-button';

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

const DISPOSITION_TONE: Record<string, string> = {
  connected: 'bg-ll/15 text-ll',
  sale: 'bg-ll/15 text-ll',
  callback: 'bg-hb/15 text-hb',
  voicemail: 'bg-vl/15 text-vl',
  no_answer: 'bg-bi/15 text-bi',
  busy: 'bg-bi/15 text-bi',
  failed: 'bg-hp/15 text-hp',
  wrong_number: 'bg-hp/15 text-hp',
  do_not_call: 'bg-hp/15 text-hp',
  not_interested: 'bg-hp/15 text-hp',
};

function formatDuration(seconds: number | null) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function timeAgo(iso: string) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function RecentCalls({ calls }: { calls: RecentCall[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex h-12 items-center border-b border-line px-5">
        <h3 className="text-[14px] font-semibold">Recent calls</h3>
        <Link
          href="/calls"
          className="ml-auto h-7 rounded-lg px-2.5 text-[12px] font-medium text-txt-2 hover:bg-surface-2"
        >
          All →
        </Link>
      </div>
      <div className="p-2">
        {calls.length === 0 ? (
          <p className="px-3 py-6 text-center text-[12px] text-txt-3">
            No calls yet. Logged calls will appear here.
          </p>
        ) : (
          calls.map((c) => {
            const disp = c.disposition ?? '';
            const tone = DISPOSITION_TONE[disp] ?? 'bg-txt-3/15 text-txt-3';
            const label = DISPOSITION_LABEL[disp] ?? '—';
            return (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-surface-2"
              >
                {c.hasRecording ? (
                  <RecordingButton callId={c.id} size="sm" />
                ) : (
                  <div
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal/10 text-teal opacity-40"
                    title="No recording available"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21" />
                    </svg>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="truncate text-[12.5px] font-medium">
                      {c.leadName ?? 'Unknown lead'}
                    </span>
                    <span className="text-[11px] text-txt-3">
                      · {c.direction === 'inbound' ? 'in' : 'out'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span
                      className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium ${tone}`}
                    >
                      {label}
                    </span>
                    <span className="font-mono text-[11px] text-txt-3">
                      {formatDuration(c.durationSec)}
                    </span>
                    <span className="ml-auto text-[11px] text-txt-3">{timeAgo(c.startedAt)}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
