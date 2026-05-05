// Phase O: snapshot endpoint for the Live Floor's active-calls grid.
// Manager-only; returns the in-progress call set for the active brand.

import { NextResponse } from 'next/server';
import { getActiveBrand } from '@/lib/active-brand';
import { getCurrentBrandRole } from '@/lib/team';
import { loadActiveCalls } from '@/lib/live-floor';

function canSeeLiveFloor(role: string | null): boolean {
  return role === 'owner' || role === 'admin' || role === 'manager';
}

export async function GET() {
  const active = await getActiveBrand();
  if (!active) return NextResponse.json([], { status: 401 });
  const role = await getCurrentBrandRole(active.id);
  if (!canSeeLiveFloor(role)) return NextResponse.json([], { status: 403 });
  const data = await loadActiveCalls(active.id);
  return NextResponse.json(data);
}
