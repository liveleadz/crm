-- Call recordings + transcription metadata for the WebRTC dialer.
--
-- The base `calls` table already has `recording_url` and `transcript`.
-- We add fields for the SignalWire recording SID, duration, and a coarse
-- transcript status so the UI can show "transcribing…" vs. "ready".
--
-- We also drop the temporary `swml_debug` table now that /dialer is
-- verified end-to-end.

alter table calls
  add column if not exists recording_sid text,
  add column if not exists recording_duration_sec int,
  add column if not exists transcript_status text;
  -- transcript_status values: null | 'pending' | 'ready' | 'failed' | 'skipped'

drop table if exists swml_debug;
