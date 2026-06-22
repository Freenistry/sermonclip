-- Fix users RLS policy to allow users to read their own record
-- The original policy had a circular dependency issue

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can view users in their church" ON public.users;

-- Allow users to read their own record (this is the critical fix)
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (id = auth.uid());
