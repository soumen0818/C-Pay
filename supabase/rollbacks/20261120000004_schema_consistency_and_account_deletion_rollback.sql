-- Rollback Migration: 20261120000004_schema_consistency_and_account_deletion_rollback.sql
-- Description: Revert FK updates and delete_my_account RPC.
--
-- NOTE: C-Pay follows a forward-fix migration policy. Rolling back schema migrations
-- is discouraged as it may cause inconsistent states across deployed environments.

BEGIN;

DROP FUNCTION IF EXISTS delete_my_account();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'add_money_claims_auth_user_id_fkey'
  ) THEN
    ALTER TABLE add_money_claims DROP CONSTRAINT add_money_claims_auth_user_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payment_records_auth_user_id_fkey'
  ) THEN
    ALTER TABLE payment_records DROP CONSTRAINT payment_records_auth_user_id_fkey;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_user_id_fkey'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_auth_user_id_fkey;
    ALTER TABLE users
      ADD CONSTRAINT users_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE add_money_claims
  ALTER COLUMN auth_user_id TYPE TEXT USING auth_user_id::text;

COMMIT;
