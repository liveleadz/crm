import 'server-only';
import { createServerClient } from '@leadpilot/db/server';

export type CalendarRow = {
  id: string;
  brandId: string;
  name: string;
  color: string | null;
  ownerMemberId: string | null;
  ownerName: string | null;
  extProvider: 'google' | 'microsoft' | null;
  extCalendarId: string | null;
  extLastSyncAt: string | null;
  defaultDurationMin: number;
  isActive: boolean;
  members: CalendarMemberRow[];
};

export type CalendarMemberRow = {
  memberId: string;
  fullName: string | null;
  email: string | null;
  canBook: boolean;
  isOwner: boolean;
};

type RawCal = {
  id: string;
  brand_id: string;
  name: string;
  color: string | null;
  owner_member_id: string | null;
  ext_provider: string | null;
  ext_calendar_id: string | null;
  ext_last_sync_at: string | null;
  default_duration_min: number;
  is_active: boolean;
};

async function hydrateMembers(
  calendarIds: string[],
): Promise<Map<string, CalendarMemberRow[]>> {
  const out = new Map<string, CalendarMemberRow[]>();
  if (calendarIds.length === 0) return out;
  const supabase = await createServerClient();
  const { data: cm } = await supabase
    .from('calendar_members')
    .select('calendar_id, member_id, can_book, is_owner')
    .in('calendar_id', calendarIds);
  const memberIds = Array.from(new Set((cm ?? []).map((r) => r.member_id)));
  const memberInfo = new Map<string, { full_name: string | null; email: string | null }>();
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, full_name, email')
      .in('id', memberIds);
    for (const m of members ?? []) {
      memberInfo.set(m.id, { full_name: m.full_name, email: m.email });
    }
  }
  for (const r of cm ?? []) {
    const list = out.get(r.calendar_id) ?? [];
    const info = memberInfo.get(r.member_id);
    list.push({
      memberId: r.member_id,
      fullName: info?.full_name ?? null,
      email: info?.email ?? null,
      canBook: r.can_book,
      isOwner: r.is_owner,
    });
    out.set(r.calendar_id, list);
  }
  return out;
}

function shapeCalendar(
  raw: RawCal,
  ownerName: string | null,
  members: CalendarMemberRow[],
): CalendarRow {
  return {
    id: raw.id,
    brandId: raw.brand_id,
    name: raw.name,
    color: raw.color,
    ownerMemberId: raw.owner_member_id,
    ownerName,
    extProvider: raw.ext_provider as 'google' | 'microsoft' | null,
    extCalendarId: raw.ext_calendar_id,
    extLastSyncAt: raw.ext_last_sync_at,
    defaultDurationMin: raw.default_duration_min,
    isActive: raw.is_active,
    members,
  };
}

export async function loadBrandCalendars(brandId: string): Promise<CalendarRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('calendars')
    .select(
      'id, brand_id, name, color, owner_member_id, ext_provider, ext_calendar_id, ext_last_sync_at, default_duration_min, is_active',
    )
    .eq('brand_id', brandId)
    .order('name', { ascending: true });
  const rows = (data ?? []) as RawCal[];
  if (rows.length === 0) return [];

  const ownerIds = Array.from(
    new Set(rows.map((r) => r.owner_member_id).filter((m): m is string => !!m)),
  );
  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, full_name, email')
      .in('id', ownerIds);
    for (const m of members ?? []) {
      ownerNames.set(m.id, m.full_name?.trim() || m.email || 'Unknown');
    }
  }
  const memberMap = await hydrateMembers(rows.map((r) => r.id));
  return rows.map((r) =>
    shapeCalendar(r, r.owner_member_id ? ownerNames.get(r.owner_member_id) ?? null : null, memberMap.get(r.id) ?? []),
  );
}

// Calendars an agent can pick from when booking. Owners always see their own.
export async function loadAssignedCalendars(
  brandId: string,
  memberId: string,
): Promise<CalendarRow[]> {
  const supabase = await createServerClient();
  const { data: cm } = await supabase
    .from('calendar_members')
    .select('calendar_id')
    .eq('member_id', memberId)
    .eq('can_book', true);
  const ids = Array.from(new Set((cm ?? []).map((r) => r.calendar_id)));
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('calendars')
    .select(
      'id, brand_id, name, color, owner_member_id, ext_provider, ext_calendar_id, ext_last_sync_at, default_duration_min, is_active',
    )
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .in('id', ids)
    .order('name', { ascending: true });
  const rows = (data ?? []) as RawCal[];
  if (rows.length === 0) return [];
  const ownerIds = Array.from(
    new Set(rows.map((r) => r.owner_member_id).filter((m): m is string => !!m)),
  );
  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: members } = await supabase
      .from('members')
      .select('id, full_name, email')
      .in('id', ownerIds);
    for (const m of members ?? []) {
      ownerNames.set(m.id, m.full_name?.trim() || m.email || 'Unknown');
    }
  }
  return rows.map((r) =>
    shapeCalendar(
      r,
      r.owner_member_id ? ownerNames.get(r.owner_member_id) ?? null : null,
      [],
    ),
  );
}

export async function loadCalendarById(
  brandId: string,
  id: string,
): Promise<CalendarRow | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('calendars')
    .select(
      'id, brand_id, name, color, owner_member_id, ext_provider, ext_calendar_id, ext_last_sync_at, default_duration_min, is_active',
    )
    .eq('brand_id', brandId)
    .eq('id', id)
    .maybeSingle();
  if (!data) return null;
  const raw = data as RawCal;
  let ownerName: string | null = null;
  if (raw.owner_member_id) {
    const { data: m } = await supabase
      .from('members')
      .select('full_name, email')
      .eq('id', raw.owner_member_id)
      .maybeSingle();
    ownerName = m ? (m.full_name?.trim() || m.email || 'Unknown') : null;
  }
  const memberMap = await hydrateMembers([raw.id]);
  return shapeCalendar(raw, ownerName, memberMap.get(raw.id) ?? []);
}

export async function memberCanBookCalendar(
  brandId: string,
  calendarId: string,
  memberId: string,
): Promise<boolean> {
  const supabase = await createServerClient();
  const { data: cal } = await supabase
    .from('calendars')
    .select('id, is_active')
    .eq('id', calendarId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (!cal || !cal.is_active) return false;
  const { data: cm } = await supabase
    .from('calendar_members')
    .select('can_book')
    .eq('calendar_id', calendarId)
    .eq('member_id', memberId)
    .maybeSingle();
  return !!cm?.can_book;
}
