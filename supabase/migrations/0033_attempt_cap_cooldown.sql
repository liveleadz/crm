-- 0033 — Per-lead attempt cap + per-disposition cooldown.
--
-- Two independent guardrails that prevent the dialer from hammering a
-- lead across overlapping campaigns:
--
--   * brands.max_dials_per_lead_per_day — hard cap on outbound calls
--     placed to the same lead within one calendar day (UTC). NULL = no
--     cap (legacy behavior).
--
--   * dispositions.cooldown_minutes — after a call resolves with this
--     disposition, suppress the lead from queue / manual dial for N
--     minutes. NULL or 0 = no cooldown. Used to express things like
--     "voicemail = wait 4h", "no answer = wait 90m" without forcing the
--     same value on every campaign.
--
-- Both filters apply on top of the existing campaigns.recently_called_minutes
-- "soft" dedupe, which stays campaign-scoped. These are brand-scoped and
-- always honored.

alter table brands
  add column if not exists max_dials_per_lead_per_day int;

alter table dispositions
  add column if not exists cooldown_minutes int;
