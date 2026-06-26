-- Add source_type and youtube_url columns to projects
ALTER TABLE projects ADD COLUMN source_type text NOT NULL DEFAULT 'upload';
ALTER TABLE projects ADD COLUMN youtube_url text;
