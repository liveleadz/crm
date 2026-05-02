-- 0030 — Branching call scripts.
--
-- Adds an optional `sections` JSONB to scripts. When present, the dialer
-- renders the active section instead of `body`; on disposition save it
-- jumps to the target section so the next call starts on the right page.
-- Shape:
--   [{ id: text, title: text, body: text,
--      jumps: [{ disposition_code: text, target_section_id: text }] }]
-- The first section in the array is the entry point. Plain-text scripts
-- continue to work unchanged: when sections is null, dialer falls back
-- to the existing body field.

alter table scripts add column if not exists sections jsonb;
