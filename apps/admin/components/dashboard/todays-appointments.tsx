import Link from 'next/link';
import type { TodayAppointment } from '@/lib/dashboard';

const STATUS_TONE: Record<string, string> = {
  confirmed: 'bg-ll/15 text-ll',
  scheduled: 'bg-bs/15 text-bs',
  pending: 'bg-bi/15 text-bi',
  rescheduled: 'bg-hb/15 text-hb',
  no_show: 'bg-hp/15 text-hp',
  cancelled: 'bg-txt-3/15 text-txt-3',
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function initials(name: string | null) {
  if (!name) return '··';
  const parts = name.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '··';
}

export function TodaysAppointments({ appointments }: { appointments: TodayAppointment[] }) {
  const confirmed = appointments.filter((a) => a.status === 'confirmed').length;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex h-12 items-center border-b border-line px-5">
        <h3 className="text-[14px] font-semibold">Today&rsquo;s appointments</h3>
        <span className="ml-2 text-[11.5px] text-txt-3">
          · {appointments.length} scheduled · {confirmed} confirmed
        </span>
        <Link
          href="/calendar"
          className="ml-auto h-7 rounded-lg px-2.5 text-[12px] font-medium text-txt-2 hover:bg-surface-2"
        >
          Calendar →
        </Link>
      </div>
      {appointments.length === 0 ? (
        <p className="px-5 py-8 text-center text-[12px] text-txt-3">
          No appointments scheduled today.
        </p>
      ) : (
        <div className="divide-y divide-line">
          {appointments.map((a) => {
            const tone = STATUS_TONE[a.status] ?? 'bg-txt-3/15 text-txt-3';
            return (
              <div key={a.id} className="flex items-center gap-4 px-5 py-3 hover:bg-surface-2">
                <div className="w-12 shrink-0 font-mono text-[12.5px] text-txt-2">
                  {formatTime(a.startsAt)}
                </div>
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal/10 text-[11px] font-semibold text-teal">
                  {initials(a.leadName)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium">
                    {a.leadName ?? 'Unknown lead'}
                  </div>
                  <div className="truncate text-[11px] text-txt-3">
                    {a.title}
                    {a.location ? ` · ${a.location}` : ''}
                  </div>
                </div>
                <span
                  className={`inline-flex h-[20px] items-center rounded-full px-2 text-[10.5px] font-medium capitalize ${tone}`}
                >
                  {a.status.replace('_', ' ')}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
