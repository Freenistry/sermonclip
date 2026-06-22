-- Fix registration flow by creating a function that handles church + user setup
-- This function uses SECURITY DEFINER to bypass RLS during registration

-- Function to complete user registration (create church and link user)
CREATE OR REPLACE FUNCTION public.complete_registration(
  p_church_name TEXT,
  p_full_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_church_id UUID;
BEGIN
  -- Get current user ID
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create the church
  INSERT INTO public.churches (name)
  VALUES (p_church_name)
  RETURNING id INTO v_church_id;

  -- Update the user with church_id and admin role
  UPDATE public.users
  SET
    church_id = v_church_id,
    role = 'admin',
    full_name = p_full_name
  WHERE id = v_user_id;

  RETURN jsonb_build_object(
    'church_id', v_church_id,
    'user_id', v_user_id
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.complete_registration(TEXT, TEXT) TO authenticated;
