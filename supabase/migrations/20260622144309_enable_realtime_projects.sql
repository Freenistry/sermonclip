-- Enable Supabase Realtime for projects table
-- This allows real-time subscriptions to project status changes

ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;

-- Note: You may also want to enable realtime for other tables:
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.transcripts;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.quotes;
