// Shared types and constants for appointments. Kept in a non-server-only
// module so client components (the calendar dialog and week grid) can
// import without dragging the server loader into the browser bundle.

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'no_show'
  | 'cancelled'
  | 'rescheduled'
  | 'pending';

export const APPT_STATUSES: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
  'rescheduled',
  'pending',
];

export type CalendarAppointment = {
  id: string;
  startsAt: string;
  endsAt: string | null;
  title: string;
  status: AppointmentStatus;
  location: string | null;
  notes: string | null;
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  memberId: string | null;
  memberName: string | null;
};
