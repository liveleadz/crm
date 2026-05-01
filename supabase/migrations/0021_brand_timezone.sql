-- Brand-local timezone. Used by the reports trend/heatmap and calendar
-- week-view to bucket and render times in the brand's local time instead
-- of the server / browser default. Default is US/Eastern since every
-- current brand operates from that footprint; per-brand overrides land
-- via the brand settings page later.

alter table brands
  add column timezone text not null default 'America/New_York';
