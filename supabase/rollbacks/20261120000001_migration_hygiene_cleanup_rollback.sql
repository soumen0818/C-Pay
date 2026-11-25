-- Rollback Migration: 20261120000001_migration_hygiene_cleanup_rollback.sql
-- Description: Rollback migration hygiene cleanup.
--
-- NOTE: C-Pay follows a forward-fix migration policy. Rolling back schema migrations
-- is discouraged as it may cause inconsistent states across deployed environments.

BEGIN;

-- Recreate contract_intent_cache table
CREATE TABLE IF NOT EXISTS contract_intent_cache (
    intent_id TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contract_intent_cache_expires_at ON contract_intent_cache(expires_at);
ALTER TABLE contract_intent_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON contract_intent_cache FROM PUBLIC, anon, authenticated;

-- Restore uuid_generate_v4 defaults
ALTER TABLE users ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE transactions ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE add_money_claims ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE wallet_backups ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE wallet_bindings ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE payment_records ALTER COLUMN id SET DEFAULT uuid_generate_v4();

COMMIT;
