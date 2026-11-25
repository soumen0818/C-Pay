-- Migration: 20261121000001_users_immutable_identity.sql
-- Issue: #160 — users could rewrite their own wallet_address and cpay_id.
--
-- users_insert_own / users_update_own let an authenticated client write every
-- column of its own row. That allowed:
--   * choosing any C-Pay ID, including case variants of someone else's
--     (resolve_cpay_id matches lower(cpay_id) ... LIMIT 1, so payments to an
--     ambiguous handle could resolve to the impostor);
--   * repointing wallet_address at an unregistered address, which made
--     current_wallet_address() grant SELECT on that address's transactions;
--   * claiming someone else's unregistered address at insert time.
--
-- After this migration:
--   * authenticated holds no INSERT and no table-level UPDATE on users. It may
--     UPDATE only display_name, profile_photo_url and biometric_enabled
--     (column-level grants; RLS still restricts it to its own row).
--   * The profile row is created by upsert_own_profile(), a SECURITY DEFINER
--     RPC that takes the wallet from the caller's active wallet_bindings row
--     (written only by the relayer) and the email from the verified JWT.
--   * C-Pay IDs are unique case-insensitively (users(lower(cpay_id))).
--   * current_wallet_address() only returns a wallet the caller is actively
--     bound to.
--
-- Idempotent: safe to re-run.

BEGIN;

LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

-- 1. Case-variant C-Pay IDs --------------------------------------------------
--    IDs differing only by case are ambiguous to resolve_cpay_id. Keep the
--    oldest holder of each lower-cased ID and give every later holder a fresh
--    database-allocated ID. The old spellings stay reserved in
--    cpay_id_reservations, so they can never be re-issued.
ALTER TABLE public.users DISABLE TRIGGER assign_users_cpay_id;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, cpay_id
    FROM (
      SELECT u.id, u.cpay_id,
             row_number() OVER (
               PARTITION BY lower(u.cpay_id)
               ORDER BY u.created_at ASC, u.id ASC
             ) AS holder_rank
      FROM public.users u
      WHERE u.cpay_id IS NOT NULL
    ) ranked
    WHERE holder_rank > 1
  LOOP
    UPDATE public.users AS u
    SET cpay_id = public.allocate_cpay_id(u.email)
    WHERE u.id = r.id;
    RAISE NOTICE 'Reassigned case-variant C-Pay ID % on users.id %', r.cpay_id, r.id;
  END LOOP;
END $$;

ALTER TABLE public.users ENABLE TRIGGER assign_users_cpay_id;

CREATE UNIQUE INDEX IF NOT EXISTS users_cpay_id_lower_unique
  ON public.users (lower(cpay_id));

-- 2. Column-level privileges --------------------------------------------------
--    Revoking the table-level privilege removes every column too; then grant
--    back only the profile columns a client may edit.
REVOKE INSERT, UPDATE ON public.users FROM PUBLIC, anon, authenticated;
GRANT UPDATE (display_name, profile_photo_url, biometric_enabled)
  ON public.users TO authenticated;

-- Clients no longer insert rows directly; upsert_own_profile() does.
DROP POLICY IF EXISTS "users_insert" ON public.users;
DROP POLICY IF EXISTS "users_insert_own" ON public.users;

-- users_update_own (own row only) still applies to the granted columns.

-- 3. Profile RPC -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_own_profile(
  p_display_name TEXT DEFAULT NULL,
  p_profile_photo_url TEXT DEFAULT NULL,
  p_biometric_enabled BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  wallet_address TEXT,
  cpay_id TEXT,
  display_name TEXT,
  profile_photo_url TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := nullif(lower(auth.email()), '');
  v_wallet TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Onboarding may call this from two screens at once; serialize per user so
  -- concurrent first calls cannot race into a duplicate insert.
  PERFORM pg_advisory_xact_lock(hashtext('upsert_own_profile:' || v_uid::TEXT));

  IF EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = v_uid) THEN
    -- Existing profile: only the editable profile fields change. The wallet
    -- and C-Pay ID are fixed (also enforced by assign_users_cpay_id).
    UPDATE public.users AS u
    SET display_name = COALESCE(p_display_name, u.display_name),
        profile_photo_url = COALESCE(p_profile_photo_url, u.profile_photo_url),
        biometric_enabled = COALESCE(p_biometric_enabled, u.biometric_enabled),
        email = COALESCE(u.email, v_email)
    WHERE u.auth_user_id = v_uid;
  ELSE
    -- New profile: the wallet comes from the relayer-written binding, never
    -- from the client.
    SELECT b.wallet_address
    INTO v_wallet
    FROM public.wallet_bindings b
    WHERE b.auth_user_id = v_uid
      AND b.is_active
    ORDER BY b.created_at ASC, b.id ASC
    LIMIT 1;

    IF v_wallet IS NULL THEN
      RAISE EXCEPTION 'No wallet is bound to this user'
        USING ERRCODE = 'P0002',
              HINT = 'Register the wallet with the relayer (/accounts/prepare) first.';
    END IF;

    -- A legacy row for this wallet with no owner is adopted by the bound user.
    UPDATE public.users AS u
    SET auth_user_id = v_uid,
        display_name = COALESCE(p_display_name, u.display_name),
        profile_photo_url = COALESCE(p_profile_photo_url, u.profile_photo_url),
        biometric_enabled = COALESCE(p_biometric_enabled, u.biometric_enabled),
        email = COALESCE(u.email, v_email)
    WHERE u.wallet_address = v_wallet
      AND u.auth_user_id IS NULL;

    IF NOT FOUND THEN
      -- cpay_id is assigned by the assign_users_cpay_id trigger.
      INSERT INTO public.users (
        auth_user_id, wallet_address, email,
        display_name, profile_photo_url, biometric_enabled
      )
      VALUES (
        v_uid, v_wallet, v_email,
        p_display_name, p_profile_photo_url, COALESCE(p_biometric_enabled, FALSE)
      );
    END IF;
  END IF;

  RETURN QUERY
  SELECT u.wallet_address, u.cpay_id, u.display_name, u.profile_photo_url
  FROM public.users u
  WHERE u.auth_user_id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_own_profile(TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_own_profile(TEXT, TEXT, BOOLEAN) TO authenticated;

-- 4. current_wallet_address(): only a wallet the caller is actively bound to.
--    CREATE OR REPLACE keeps the existing ACL (authenticated only).
CREATE OR REPLACE FUNCTION current_wallet_address()
RETURNS TEXT AS $$
  SELECT u.wallet_address
  FROM users u
  JOIN wallet_bindings b
    ON b.auth_user_id = u.auth_user_id
   AND b.wallet_address = u.wallet_address
   AND b.is_active
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

COMMIT;
