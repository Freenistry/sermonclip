-- Add cancelling and cancelled to the status check constraint

-- Drop the existing constraint
ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_status_check;

-- Add updated constraint with new statuses
ALTER TABLE public.projects ADD CONSTRAINT projects_status_check
  CHECK (status IN (
    'uploading',
    'processing',
    'downloading',
    'extracting_audio',
    'transcribing',
    'analyzing',
    'completed',
    'failed',
    'cancelling',
    'cancelled'
  ));
