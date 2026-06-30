CREATE TABLE public.saved_clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches(id),
  project_id UUID NOT NULL REFERENCES public.projects(id),
  highlight_id UUID NOT NULL REFERENCES public.sermon_highlights(id),
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  video_path TEXT NOT NULL,
  duration_seconds DECIMAL,
  quote_text TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_saved_clips_church ON saved_clips(church_id);
CREATE INDEX idx_saved_clips_project ON saved_clips(project_id);

ALTER TABLE saved_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view clips from their church"
  ON saved_clips FOR SELECT
  USING (church_id IN (SELECT church_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can insert clips for their church"
  ON saved_clips FOR INSERT
  WITH CHECK (church_id IN (SELECT church_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can delete clips from their church"
  ON saved_clips FOR DELETE
  USING (church_id IN (SELECT church_id FROM public.users WHERE id = auth.uid()));
