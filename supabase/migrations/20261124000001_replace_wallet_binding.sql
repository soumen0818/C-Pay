-- Replace the authenticated user's active wallet and profile binding as one
-- transaction. The current C-Pay ID stays attached to the users row.
CREATE OR REPLACE FUNCTION replace_own_wallet_binding(p_new_wallet_address TEXT)
RETURNS TABLE (wallet_address TEXT, cpay_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_user_id UUID := auth.uid();
  v_cpay_id TEXT;
BEGIN
  IF v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_new_wallet_address IS NULL OR p_new_wallet_address !~ '^G[A-Z2-7]{55}$' THEN
    RAISE EXCEPTION 'Invalid Stellar wallet address' USING ERRCODE = '22023';
  END IF;

  UPDATE users
  SET wallet_address = p_new_wallet_address
  WHERE auth_user_id = v_auth_user_id
  RETURNING users.cpay_id INTO v_cpay_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile exists for the authenticated user' USING ERRCODE = 'P0002';
  END IF;

  UPDATE wallet_bindings
  SET is_active = FALSE
  WHERE auth_user_id = v_auth_user_id AND is_active;

  INSERT INTO wallet_bindings (auth_user_id, wallet_address, is_active)
  VALUES (v_auth_user_id, p_new_wallet_address, TRUE)
  ON CONFLICT (auth_user_id, wallet_address)
  DO UPDATE SET is_active = TRUE;

  RETURN QUERY SELECT p_new_wallet_address, v_cpay_id;
END;
$$;

REVOKE ALL ON FUNCTION replace_own_wallet_binding(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION replace_own_wallet_binding(TEXT) TO authenticated;
