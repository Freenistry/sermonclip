-- Merge suggestions table for AI-suggested highlight merges
CREATE TABLE public.merge_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  church_id UUID REFERENCES public.churches(id) ON DELETE CASCADE,
  highlight_ids UUID[] NOT NULL,
  reason TEXT NOT NULL,
  merged_title TEXT NOT NULL,
  merged_start_time DECIMAL NOT NULL,
  merged_end_time DECIMAL NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_merge_suggestions_project_id ON public.merge_suggestions(project_id);

-- RLS
ALTER TABLE public.merge_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view church merge suggestions" ON public.merge_suggestions
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.projects WHERE church_id IN (
        SELECT church_id FROM public.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Service can insert merge suggestions" ON public.merge_suggestions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Service can update merge suggestions" ON public.merge_suggestions
  FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "Service can delete merge suggestions" ON public.merge_suggestions
  FOR DELETE USING (true);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merge_suggestions TO authenticated;
GRANT ALL ON public.merge_suggestions TO service_role;
