-- Churches/organizations
CREATE TABLE public.churches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  brand_colors JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Users (supports team collaboration)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  church_id UUID REFERENCES public.churches(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'editor' CHECK (role IN ('admin', 'editor', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Projects (uploaded sermons)
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  video_url TEXT,
  audio_url TEXT,
  video_duration_seconds INTEGER,
  status TEXT DEFAULT 'uploading' CHECK (status IN ('uploading', 'processing', 'transcribing', 'analyzing', 'ready', 'error')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Transcripts
CREATE TABLE public.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  full_text TEXT,
  segments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Extracted quotes
CREATE TABLE public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  start_time DECIMAL,
  end_time DECIMAL,
  shareability_score INTEGER CHECK (shareability_score >= 1 AND shareability_score <= 10),
  context_caption TEXT,
  selected BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX idx_users_church_id ON public.users(church_id);
CREATE INDEX idx_projects_church_id ON public.projects(church_id);
CREATE INDEX idx_projects_user_id ON public.projects(user_id);
CREATE INDEX idx_projects_status ON public.projects(status);
CREATE INDEX idx_transcripts_project_id ON public.transcripts(project_id);
CREATE INDEX idx_quotes_project_id ON public.quotes(project_id);

-- Enable RLS
ALTER TABLE public.churches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Churches
CREATE POLICY "Users can view their church" ON public.churches
  FOR SELECT USING (
    id IN (SELECT church_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Admins can update their church" ON public.churches
  FOR UPDATE USING (
    id IN (SELECT church_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- RLS Policies: Users
CREATE POLICY "Users can view users in their church" ON public.users
  FOR SELECT USING (
    church_id IN (SELECT church_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (id = auth.uid());

-- RLS Policies: Projects
CREATE POLICY "Users can view church projects" ON public.projects
  FOR SELECT USING (
    church_id IN (SELECT church_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Editors can create projects" ON public.projects
  FOR INSERT WITH CHECK (
    church_id IN (SELECT church_id FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'editor'))
  );

CREATE POLICY "Editors can update projects" ON public.projects
  FOR UPDATE USING (
    church_id IN (SELECT church_id FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'editor'))
  );

CREATE POLICY "Admins can delete projects" ON public.projects
  FOR DELETE USING (
    church_id IN (SELECT church_id FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );

-- RLS Policies: Transcripts
CREATE POLICY "Users can view church transcripts" ON public.transcripts
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.projects WHERE church_id IN (
        SELECT church_id FROM public.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Service can insert transcripts" ON public.transcripts
  FOR INSERT WITH CHECK (true);

-- RLS Policies: Quotes
CREATE POLICY "Users can view church quotes" ON public.quotes
  FOR SELECT USING (
    project_id IN (
      SELECT id FROM public.projects WHERE church_id IN (
        SELECT church_id FROM public.users WHERE id = auth.uid()
      )
    )
  );

CREATE POLICY "Editors can update quotes" ON public.quotes
  FOR UPDATE USING (
    project_id IN (
      SELECT id FROM public.projects WHERE church_id IN (
        SELECT church_id FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'editor')
      )
    )
  );

CREATE POLICY "Service can insert quotes" ON public.quotes
  FOR INSERT WITH CHECK (true);

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.churches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcripts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO authenticated;
GRANT ALL ON public.churches TO service_role;
GRANT ALL ON public.users TO service_role;
GRANT ALL ON public.projects TO service_role;
GRANT ALL ON public.transcripts TO service_role;
GRANT ALL ON public.quotes TO service_role;

-- Create storage bucket for videos
INSERT INTO storage.buckets (id, name, public) VALUES ('videos', 'videos', false);

-- Storage policies
CREATE POLICY "Users can upload videos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'videos' AND
    auth.uid() IS NOT NULL
  );

CREATE POLICY "Users can view church videos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'videos' AND
    auth.uid() IS NOT NULL
  );
