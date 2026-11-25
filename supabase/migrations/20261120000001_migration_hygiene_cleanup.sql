-- Migration: 20261120000001_migration_hygiene_cleanup.sql
-- Issue: #225 — Migration hygiene: non-idempotent policies, dead tables, missing rollbacks.
--
-- Fixes:
--   1. Drops dead Soroban contract_intent_cache table and leftover indexes.
--   2. Normalises RLS policies idempotently across surviving tables (wallet_bindings, payment_records, transactions, ingest_state).
--   3. Modernizes UUID primary key column defaults from uuid_generate_v4() to Postgres built-in gen_random_uuid().
--
-- Replay safe and idempotent.

BEGIN;

-- 1. Drop dead Soroban contract_intent_cache table and leftover indexes
DROP INDEX IF EXISTS idx_contract_intent_cache_expires_at;
DROP TABLE IF EXISTS contract_intent_cache CASCADE;

-- 2. Normalise wallet_bindings policies
-- Ensure stale client write policies are removed and participant select is idempotent and properly scoped.
DROP POLICY IF EXISTS "wallet_bindings_select_own" ON wallet_bindings;
DROP POLICY IF EXISTS "wallet_bindings_insert_own" ON wallet_bindings;
DROP POLICY IF EXISTS "wallet_bindings_update_own" ON wallet_bindings;
CREATE POLICY "wallet_bindings_select_own" ON wallet_bindings
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND auth_user_id = auth.uid());

-- 3. Normalise payment_records policy
-- Ensure idempotent re-run with DROP POLICY IF EXISTS.
DROP POLICY IF EXISTS "payment_records_service_all" ON payment_records;
CREATE POLICY "payment_records_service_all" ON payment_records
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 4. Normalise transactions policies
DROP POLICY IF EXISTS "transactions_select_participant" ON transactions;
CREATE POLICY "transactions_select_participant" ON transactions
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND (
      from_address = current_wallet_address()
      OR to_address = current_wallet_address()
    )
  );

DROP POLICY IF EXISTS "transactions_service_all" ON transactions;
CREATE POLICY "transactions_service_all" ON transactions
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 5. Normalise ingest_state policy
DROP POLICY IF EXISTS "ingest_state_service_all" ON ingest_state;
CREATE POLICY "ingest_state_service_all" ON ingest_state
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

-- 6. Modernize UUID default generators to PostgreSQL built-in gen_random_uuid()
ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE transactions ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE add_money_claims ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE wallet_backups ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE wallet_bindings ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE payment_records ALTER COLUMN id SET DEFAULT gen_random_uuid();

COMMIT;
