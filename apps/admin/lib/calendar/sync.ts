import 'server-only';
import { createAdminClient } from '@leadpilot/db/admin';
import * as google from './google';

type EventInput = {
  summary: string;
  description?: string | null;
  location?: string | null;
  startIso: string;
  endIso: string | null;
};

function asEventInput(a: {
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string | null;
}): EventInput {
  return {
    summary: a.title,
    description: a.notes,
    location: a.location,
    startIso: a.starts_at,
    endIso: a.ends_at,
  };
}

async function loadAppointment(appointmentId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('appointments')
    .select(
      'id, title, notes, location, starts_at, ends_at, calendar_id, ext_event_id, ext_etag, ext_status',
    )
    .eq('id', appointmentId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function loadCalendar(calendarId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from('calendars')
    .select(
      'id, ext_provider, ext_calendar_id, owner_member_id, is_active',
    )
    .eq('id', calendarId)
    .maybeSingle();
  return data ?? null;
}

async function setExt(
  appointmentId: string,
  patch: { ext_event_id?: string | null; ext_etag?: string | null; ext_status: string },
) {
  const admin = createAdminClient();
  await admin.from('appointments').update(patch).eq('id', appointmentId);
}

// Push CRM → external. Best-effort: failures flip ext_status='failed' so the
// pull cron can retry. Caller awaits but should not surface errors to the user.
export async function pushAppointment(appointmentId: string): Promise<void> {
  const appt = await loadAppointment(appointmentId);
  if (!appt) return;
  if (!appt.calendar_id) {
    await setExt(appointmentId, { ext_status: 'local' });
    return;
  }
  const cal = await loadCalendar(appt.calendar_id);
  if (!cal || !cal.is_active || !cal.ext_provider || !cal.ext_calendar_id || !cal.owner_member_id) {
    await setExt(appointmentId, { ext_status: 'local' });
    return;
  }

  if (cal.ext_provider !== 'google') {
    await setExt(appointmentId, { ext_status: 'failed' });
    return;
  }

  try {
    const event = asEventInput(appt);
    if (appt.ext_event_id) {
      const result = await google.patchEvent({
        memberId: cal.owner_member_id,
        extCalendarId: cal.ext_calendar_id,
        extEventId: appt.ext_event_id,
        event,
        etag: appt.ext_etag,
      });
      await setExt(appointmentId, {
        ext_event_id: result.id,
        ext_etag: result.etag ?? null,
        ext_status: 'pushed',
      });
    } else {
      const result = await google.pushEvent({
        memberId: cal.owner_member_id,
        extCalendarId: cal.ext_calendar_id,
        event,
      });
      await setExt(appointmentId, {
        ext_event_id: result.id,
        ext_etag: result.etag ?? null,
        ext_status: 'pushed',
      });
    }
  } catch (e) {
    console.error('[calendar.sync.push]', appointmentId, e);
    await setExt(appointmentId, { ext_status: 'failed' });
  }
}

// Synchronous external delete used by deleteAppointment. Best-effort.
export async function deleteExternalEvent(input: {
  calendarId: string;
  extEventId: string | null;
}): Promise<void> {
  if (!input.extEventId) return;
  const cal = await loadCalendar(input.calendarId);
  if (!cal || cal.ext_provider !== 'google' || !cal.ext_calendar_id || !cal.owner_member_id) return;
  try {
    await google.deleteEvent({
      memberId: cal.owner_member_id,
      extCalendarId: cal.ext_calendar_id,
      extEventId: input.extEventId,
    });
  } catch (e) {
    console.error('[calendar.sync.delete]', input.extEventId, e);
  }
}

// Pull external → CRM for one calendar. Returns a small summary used by the
// cron route for logging. Reconciles by ext_event_id; unknown events are
// inserted as ext_only (lead_id null).
export async function pullCalendar(calendarId: string): Promise<{
  upserts: number;
  removes: number;
}> {
  const cal = await loadCalendar(calendarId);
  if (
    !cal ||
    !cal.is_active ||
    cal.ext_provider !== 'google' ||
    !cal.ext_calendar_id ||
    !cal.owner_member_id
  ) {
    return { upserts: 0, removes: 0 };
  }

  const admin = createAdminClient();
  const { data: tokRow } = await admin
    .from('calendars')
    .select('ext_sync_token, brand_id')
    .eq('id', calendarId)
    .maybeSingle();

  const brandId = tokRow?.brand_id as string | undefined;
  if (!brandId) return { upserts: 0, removes: 0 };

  let upserts = 0;
  let removes = 0;

  const { events, nextSyncToken } = await google.listDelta({
    memberId: cal.owner_member_id,
    extCalendarId: cal.ext_calendar_id,
    syncToken: tokRow?.ext_sync_token ?? null,
  });
  for (const ev of events) {
    const startIso = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
    const endIso = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
    if (ev.status === 'cancelled') {
      const { count } = await admin
        .from('appointments')
        .delete({ count: 'exact' })
        .eq('calendar_id', calendarId)
        .eq('ext_event_id', ev.id);
      removes += count ?? 0;
      continue;
    }
    if (!startIso) continue;
    const { data: existing } = await admin
      .from('appointments')
      .select('id, lead_id')
      .eq('calendar_id', calendarId)
      .eq('ext_event_id', ev.id)
      .maybeSingle();
    if (existing) {
      await admin
        .from('appointments')
        .update({
          title: ev.summary ?? '(no title)',
          notes: ev.description ?? null,
          location: ev.location ?? null,
          starts_at: startIso,
          ends_at: endIso,
          ext_etag: ev.etag ?? null,
          ext_status: existing.lead_id ? 'pushed' : 'ext_only',
        })
        .eq('id', existing.id);
    } else {
      await admin.from('appointments').insert({
        brand_id: brandId,
        calendar_id: calendarId,
        lead_id: null,
        member_id: cal.owner_member_id,
        title: ev.summary ?? '(no title)',
        notes: ev.description ?? null,
        location: ev.location ?? null,
        starts_at: startIso,
        ends_at: endIso,
        status: 'scheduled',
        ext_event_id: ev.id,
        ext_etag: ev.etag ?? null,
        ext_status: 'ext_only',
      });
    }
    upserts += 1;
  }

  await admin
    .from('calendars')
    .update({
      ext_sync_token: nextSyncToken,
      ext_last_sync_at: new Date().toISOString(),
    })
    .eq('id', calendarId);

  return { upserts, removes };
}
