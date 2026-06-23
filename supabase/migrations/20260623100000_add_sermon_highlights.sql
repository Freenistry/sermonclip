-- Sermon Highlights table
CREATE TABLE public.sermon_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  church_id UUID REFERENCES public.churches(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  transcript_excerpt TEXT NOT NULL,
  quote_text TEXT NOT NULL,
  start_time DECIMAL NOT NULL,
  end_time DECIMAL NOT NULL,
  duration_tier TEXT NOT NULL CHECK (duration_tier IN ('short', 'medium', 'long')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_highlights_project_id ON public.sermon_highlights(project_id);

ALTER TABLE public.sermon_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view church highlights" ON public.sermon_highlights
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.projects WHERE church_id IN (
        SELECT church_id FROM public.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Service can insert highlights" ON public.sermon_highlights
  FOR INSERT WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sermon_highlights TO authenticated;
GRANT ALL ON public.sermon_highlights TO service_role;

-- Add highlight_id FK to quotes
ALTER TABLE public.quotes ADD COLUMN highlight_id UUID REFERENCES public.sermon_highlights(id) ON DELETE SET NULL;

-- Add extracting_highlights to valid project statuses
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE public.projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('uploading', 'processing', 'downloading', 'extracting_audio', 'transcribing', 'analyzing', 'extracting_highlights', 'ready', 'error', 'completed', 'failed', 'cancelled', 'cancelling'));
