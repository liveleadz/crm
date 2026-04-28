import Link from 'next/link';
import type { Route } from 'next';
import type { Kpis } from '@/lib/dashboard';

type Card = {
  icon: 'users' | 'cal' | 'alert' | 'phone';
  value: string;
  label: string;
  href: Route;
  accent: 'teal' | 'bs' | 'hp' | 'hb';
  primary?: boolean;
};

const ICONS: Record<Card['icon'], React.ReactNode> = {
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </>
  ),
  cal: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  alert: (
    <>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
    </>
  ),
  phone: (
    <>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </>
  ),
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-US').format(n);
}

export function KpiCards({ kpis }: { kpis: Kpis }) {
  const cards: Card[] = [
    {
      icon: 'users',
      value: fmt(kpis.activeLeads),
      label: 'Active leads',
      href: '/leads',
      accent: 'teal',
      primary: true,
    },
    {
      icon: 'cal',
      value: fmt(kpis.todaysAppointments),
      label: "Today's appointments",
      href: '/calendar',
      accent: 'bs',
    },
    {
      icon: 'alert',
      value: fmt(kpis.noShowsThisWeek),
      label: 'No-shows this week',
      href: '/reports',
      accent: 'hp',
    },
    {
      icon: 'phone',
      value: fmt(kpis.callsThisWeek),
      label: 'Calls this week',
      href: '/calls',
      accent: 'hb',
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((c) => (
        <KpiCard key={c.label} card={c} />
      ))}
    </div>
  );
}

function KpiCard({ card }: { card: Card }) {
  const { icon, value, label, href, accent, primary } = card;
  if (primary) {
    return (
      <Link
        href={href}
        className="group relative overflow-hidden rounded-2xl bg-teal p-5 text-teal-fg"
      >
        <div className="flex items-start justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {ICONS[icon]}
            </svg>
          </div>
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/15 transition group-hover:bg-white/25">
            <ArrowOut />
          </span>
        </div>
        <div className="mt-8 font-mono text-[30px] font-semibold leading-none tracking-tight">{value}</div>
        <div className="mt-1 text-[12.5px] text-teal-fg/80">{label}</div>
      </Link>
    );
  }
  const accentClasses: Record<Card['accent'], { bg: string; text: string }> = {
    teal: { bg: 'bg-teal/10', text: 'text-teal' },
    bs: { bg: 'bg-bs/10', text: 'text-bs' },
    hp: { bg: 'bg-hp/10', text: 'text-hp' },
    hb: { bg: 'bg-hb/10', text: 'text-hb' },
  };
  const cls = accentClasses[accent];
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-line bg-surface p-5 transition hover:border-line-2"
    >
      <div className="flex items-start justify-between">
        <div className={`grid h-10 w-10 place-items-center rounded-xl ${cls.bg}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={cls.text}>
            {ICONS[icon]}
          </svg>
        </div>
        <span className="grid h-8 w-8 place-items-center rounded-xl text-txt-3 transition group-hover:bg-surface-2">
          <ArrowOut />
        </span>
      </div>
      <div className="mt-8 font-mono text-[30px] font-semibold leading-none tracking-tight">{value}</div>
      <div className="mt-1 text-[12.5px] text-txt-2">{label}</div>
    </Link>
  );
}

function ArrowOut() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}
