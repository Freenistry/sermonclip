-- Add church_id column to transcripts and quotes tables for multi-tenant isolation

-- Add church_id to transcripts
ALTER TABLE public.transcripts
ADD COLUMN church_id UUID REFERENCES public.churches(id) ON DELETE CASCADE;

-- Backfill church_id from project's church_id
UPDATE public.transcripts t
SET church_id = p.church_id
FROM public.projects p
WHERE t.project_id = p.id;

-- Make church_id NOT NULL after backfill
ALTER TABLE public.transcripts
ALTER COLUMN church_id SET NOT NULL;

-- Add index for church_id lookups
CREATE INDEX idx_transcripts_church_id ON public.transcripts(church_id);

-- Add church_id to quotes
ALTER TABLE public.quotes
ADD COLUMN church_id UUID REFERENCES public.churches(id) ON DELETE CASCADE;

-- Backfill church_id from project's church_id
UPDATE public.quotes q
SET church_id = p.church_id
FROM public.projects p
WHERE q.project_id = p.id;

-- Make church_id NOT NULL after backfill
ALTER TABLE public.quotes
ALTER COLUMN church_id SET NOT NULL;

-- Add index for church_id lookups
CREATE INDEX idx_quotes_church_id ON public.quotes(church_id);

-- Also add context column to quotes (used by backend but may be missing)
ALTER TABLE public.quotes
ADD COLUMN IF NOT EXISTS context TEXT;

-- Add status column to quotes (used by backend)
ALTER TABLE public.quotes
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
