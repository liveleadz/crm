-- Phase M: Disposition categories.
--
-- Each brand can rename / re-tone / add their own dispositions, so the
-- code names ('connected', 'no_answer', etc.) aren't safe to read in
-- the reports layer — a brand could call their good outcome 'closed'
-- and the connect rate would silently drop to 0.
--
-- This migration adds a fixed-vocabulary `category` column the reports
-- layer can aggregate against regardless of the brand's chosen labels.
-- The default for existing + new rows is 'other'; we backfill known
-- defaults from migration 0011 so reports keep working out of the box.

alter table dispositions
  add column if not exists category text not null default 'other'
    check (category in (
      'wrong_number','no_answer','voicemail','connected',
      'appointment_set','callback','do_not_call','not_interested','other'
    ));

create index if not exists dispositions_brand_category_idx
  on dispositions(brand_id, category);

-- Backfill: tag rows seeded by migration 0011 with their semantic
-- category. We match by code so brands that have already renamed the
-- label keep working. Only update rows still flagged 'other' so manual
-- assignments aren't clobbered if the migration re-runs.
update dispositions set category='connected'
  where category='other' and code in ('connected','sale','closed_won');
update dispositions set category='callback'
  where category='other' and code ilike 'callback%';
update dispositions set category='voicemail'
  where category='other' and code ilike 'voicemail%';
update dispositions set category='no_answer'
  where category='other' and code in ('no_answer','noanswer','no-answer','busy');
update dispositions set category='wrong_number'
  where category='other' and (code ilike 'wrong%number%' or code='wrong_number');
update dispositions set category='not_interested'
  where category='other' and code ilike 'not_interested%';
update dispositions set category='do_not_call'
  where category='other' and code in ('dnc','do_not_call');
update dispositions set category='appointment_set'
  where category='other' and (code ilike 'appt%' or code ilike 'appointment%' or code='booked');

-- Update the seed-on-brand-create trigger so freshly-onboarded brands
-- get the same category mapping. We rebuild the function rather than
-- trying to ALTER it; safe because the body is short.
create or replace function seed_dispositions_for_brand() returns trigger
  language plpgsql as $$
begin
  insert into dispositions (brand_id, code, label, tone, category, sort_order) values
    (new.id, 'connected',      'Connected',      'good',    'connected',       1),
    (new.id, 'sale',            'Sale',           'good',    'connected',       2),
    (new.id, 'callback',        'Callback',       'good',    'callback',        3),
    (new.id, 'voicemail',       'Voicemail',      'neutral', 'voicemail',       4),
    (new.id, 'no_answer',       'No answer',      'neutral', 'no_answer',       5),
    (new.id, 'busy',            'Busy',           'neutral', 'no_answer',       6),
    (new.id, 'wrong_number',    'Wrong number',   'bad',     'wrong_number',    7),
    (new.id, 'not_interested',  'Not interested', 'bad',     'not_interested',  8),
    (new.id, 'do_not_call',     'DNC',            'bad',     'do_not_call',     9),
    (new.id, 'failed',          'Failed',         'bad',     'other',          10)
  on conflict (brand_id, code) do nothing;
  return new;
end;
$$;
