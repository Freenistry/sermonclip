-- Add is_merged flag to sermon_highlights to identify clips created from merge suggestions
ALTER TABLE public.sermon_highlights ADD COLUMN is_merged BOOLEAN NOT NULL DEFAULT false;
