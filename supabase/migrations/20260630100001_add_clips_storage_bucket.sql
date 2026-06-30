-- Create storage bucket for saved clips
INSERT INTO storage.buckets (id, name, public) VALUES ('clips', 'clips', false);

-- Storage policies
CREATE POLICY "Users can upload clips" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'clips' AND
    auth.uid() IS NOT NULL
  );

CREATE POLICY "Users can view clips" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'clips' AND
    auth.uid() IS NOT NULL
  );

CREATE POLICY "Users can delete clips" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'clips' AND
    auth.uid() IS NOT NULL
  );
