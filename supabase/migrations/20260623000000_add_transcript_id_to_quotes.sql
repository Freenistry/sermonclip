-- Add transcript_id column to quotes table

ALTER TABLE public.quotes
ADD COLUMN transcript_id UUID REFERENCES public.transcripts(id) ON DELETE CASCADE;

-- Create index for transcript_id lookups
CREATE INDEX idx_quotes_transcript_id ON public.quotes(transcript_id);
