-- Migration: 20261120000004_schema_consistency_and_account_deletion.sql
-- Issue: #228 — Schema consistency: mixed ID types, orphaned rows, no account deletion
--
-- Fixes:
--   1. Migrates add_money_claims.auth_user_id to UUID and adds FK to auth.users(id) ON DELETE CASCADE.
--   2. Adds FK from payment_records.auth_user_id to auth.users(id) ON DELETE CASCADE.
--   3. Updates users.auth_user_id FK from ON DELETE SET NULL to ON DELETE CASCADE so deleting an auth user removes their profile and unresolves their C-Pay ID.
--   4. Adds delete_my_account() SECURITY DEFINER RPC granted to authenticated.
--   5. Ensures phone_number column is dropped from users.

BEGIN;

-- 1. Ensure phone_number is absent from users
ALTER TABLE users DROP COLUMN IF EXISTS phone_number;

-- 2. Migrate add_money_claims.auth_user_id from TEXT to UUID and add FK
ALTER TABLE add_money_claims
  ALTER COLUMN auth_user_id TYPE UUID USING (
    CASE
      WHEN auth_user_id IS NULL OR auth_user_id = '' THEN NULL
      ELSE auth_user_id::uuid
    END
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'add_money_claims_auth_user_id_fkey'
  ) THEN
    ALTER TABLE add_money_claims
      ADD CONSTRAINT add_money_claims_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. Add FK on payment_records.auth_user_id referencing auth.users(id) ON DELETE CASCADE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_records_auth_user_id_fkey'
  ) THEN
    ALTER TABLE payment_records
      ADD CONSTRAINT payment_records_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Update users.auth_user_id foreign key from ON DELETE SET NULL to ON DELETE CASCADE
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
  ) LOOP
    EXECUTE 'ALTER TABLE public.users DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_auth_user_id_fkey
  FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 5. Add delete_my_account() RPC for authenticated users
CREATE OR REPLACE FUNCTION delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Delete from auth.users, cascading to users, wallet_backups, wallet_bindings,
  -- add_money_claims, payment_records, and client idempotency keys.
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_my_account() TO authenticated;

COMMIT;
