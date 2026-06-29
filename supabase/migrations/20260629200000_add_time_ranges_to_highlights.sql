-- Add time_ranges JSONB column for multi-segment merged clips
-- Format: [{"start": 90.0, "end": 120.0}, {"start": 180.0, "end": 210.0}]
-- NULL for regular (non-merged) highlights which use start_time/end_time
ALTER TABLE public.sermon_highlights ADD COLUMN time_ranges JSONB;
