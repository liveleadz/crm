// Phase O: snapshot endpoint for the Live Floor's agent grid.
// Manager-only; returns one row per active brand member.

import { NextResponse } from 'next/server';
import { getActiveBrand } from '@/lib/active-brand';
import { getCurrentBrandRole } from '@/lib/team';
import { loadAgentSnapshots } from '@/lib/live-floor';

function canSeeLiveFloor(role: string | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export async function GET() {
  const active = await getActiveBrand();
  if (!active) return NextResponse.json([], { status: 401 });
  const role = await getCurrentBrandRole(active.id);
  if (!canSeeLiveFloor(role)) return NextResponse.json([], { status: 403 });
  const data = await loadAgentSnapshots(active.id);
  return NextResponse.json(data);
}
