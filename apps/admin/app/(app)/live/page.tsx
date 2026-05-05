// Phase O: Live Floor — manager-only situational awareness page.
//
// Three panels, top-down:
//  1. Active calls — one card per call in progress, with elapsed timer.
//  2. Agents — presence + today's stats per agent, filterable.
//  3. Today's pulse — last-90-min trend strip + brand-wide KPI row.

import { notFound } from 'next/navigation';
import { getActiveBrand } from '@/lib/active-brand';
import { getCurrentBrandRole, type MemberRole } from '@/lib/team';
import {
  loadActiveCalls,
  loadAgentSnapshots,
  loadBrandPulse,
} from '@/lib/live-floor';
import { ActiveCallsGrid } from '@/components/live-floor/active-calls';
import { AgentGrid } from '@/components/live-floor/agent-grid';

function canSeeLiveFloor(role: MemberRole | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export const dynamic = 'force-dynamic';

export default async function LiveFloorPage() {
  const active = await getActiveBrand();
  if (!active) notFound();
  const role = await getCurrentBrandRole(active.id);
  if (!canSeeLiveFloor(role)) notFound();

  const [activeCalls, agents, pulse] = await Promise.all([
    loadActiveCalls(active.id),
    loadAgentSnapshots(active.id),
    loadBrandPulse(active.id),
  ]);

  // Pulse strip max for normalization — guards against a flat row when
  // there's been zero activity (we still render the bars at 0%).
  const peak = Math.max(1, ...pulse.buckets.map((b) => b.calls));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight">Live floor</h1>
        <p className="text-[12.5px] text-txt-3">
          What the team is doing right now in {active.name}.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-txt-3">
          Active calls
          <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-[10.5px] text-txt-2">
            {activeCalls.length}
          </span>
        </h2>
        <ActiveCallsGrid brandId={active.id} initial={activeCalls} />
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-txt-3">
          Agents
        </h2>
        <AgentGrid brandId={active.id} initial={agents} />
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-txt-3">
          Today's pulse · last 90 minutes
        </h2>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PulseKpi label="Calls" value={pulse.totals.calls} />
            <PulseKpi label="Connects" value={pulse.totals.connects} />
            <PulseKpi label="Voicemails" value={pulse.totals.voicemails} />
            <PulseKpi label="Appointments" value={pulse.totals.appointments} />
          </div>
          <div className="mt-4 flex h-16 items-end gap-1">
            {pulse.buckets.map((b) => {
              const h = Math.round((b.calls / peak) * 100);
              const ch = b.calls > 0 ? Math.round((b.connects / b.calls) * h) : 0;
              return (
                <div
                  key={b.startMs}
                  className="relative flex flex-1 items-end overflow-hidden rounded-sm bg-canvas"
                  title={`${b.calls} calls · ${b.connects} connects`}
                >
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-teal/30"
                    style={{ height: `${h}%` }}
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-teal"
                    style={{ height: `${ch}%` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function PulseKpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-canvas/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-txt-3">{label}</div>
      <div className="mt-0.5 text-[18px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
