BEGIN;

SELECT plan(13);

-- Functions owned by an extension (uuid-ossp, pgtap, ...) are not ours to audit.
CREATE TEMP VIEW audited_functions AS
SELECT p.oid, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND NOT EXISTS (
    SELECT 1 FROM pg_depend d
    WHERE d.classid = 'pg_proc'::regclass
      AND d.objid = p.oid
      AND d.deptype = 'e'
  );

CREATE TEMP VIEW audited_tables AS
SELECT c.oid, c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v', 'm');

-- Merchant objects (#125) ---------------------------------------------------

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM audited_functions
    WHERE proname IN (
      'get_public_merchant_by_id',
      'get_public_merchant_by_address',
      'get_own_merchant_by_wallet',
      'refresh_merchant_totals',
      'update_merchant_totals_from_transaction'
    )
  ),
  'no grant can exist for a dropped merchant function: none of them exist'
);

SELECT ok(
  to_regclass('public.merchant_contact_verifications') IS NULL
  OR NOT has_table_privilege('authenticated', 'public.merchant_contact_verifications', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'merchant_contact_verifications is not client-writable'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM audited_functions
    WHERE pg_get_functiondef(oid) ILIKE '%merchant%'
  ),
  'no surviving function reads a merchant object'
);

-- Function EXECUTE grants ---------------------------------------------------

SELECT is_empty(
  $$ SELECT proname FROM audited_functions
     WHERE pg_get_function_result(oid) <> 'trigger'
       AND has_function_privilege('anon', oid, 'EXECUTE') $$,
  'anon cannot execute any public RPC'
);

SELECT set_eq(
  $$ SELECT proname::TEXT FROM audited_functions
     WHERE pg_get_function_result(oid) <> 'trigger'
       AND has_function_privilege('authenticated', oid, 'EXECUTE') $$,
  ARRAY['current_wallet_address', 'delete_my_account', 'get_public_wallet_profile', 'resolve_cpay_id'],
  'authenticated can execute exactly the client RPCs'
);

-- Table grants --------------------------------------------------------------

SELECT is_empty(
  $$ SELECT relname FROM audited_tables
     WHERE has_table_privilege('anon', oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') $$,
  'anon holds no privilege on any public table'
);

SELECT set_eq(
  $$ SELECT relname::TEXT FROM audited_tables
     WHERE has_table_privilege('authenticated', oid, 'INSERT, UPDATE, DELETE') $$,
  ARRAY['users', 'wallet_backups'],
  'authenticated can write only users and wallet_backups'
);

SELECT set_eq(
  $$ SELECT relname::TEXT FROM audited_tables
     WHERE has_table_privilege('authenticated', oid, 'SELECT') $$,
  ARRAY['users', 'wallet_backups', 'transactions', 'wallet_bindings'],
  'authenticated can read only users, wallet_backups, transactions, and wallet_bindings'
);

SELECT is_empty(
  $$ SELECT relname FROM audited_tables
     WHERE has_table_privilege('authenticated', oid, 'TRUNCATE') $$,
  'authenticated cannot TRUNCATE any public table (TRUNCATE bypasses RLS)'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.users', 'DELETE'),
  'authenticated cannot DELETE users'
);

-- wallet_bindings is the relayer's ownership source --------------------------

SELECT is_empty(
  $$ SELECT policyname FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'wallet_bindings'
       AND cmd <> 'SELECT' $$,
  'wallet_bindings has no client write policy'
);

SELECT ok(
  has_table_privilege('service_role', 'public.wallet_bindings', 'SELECT')
  AND has_table_privilege('service_role', 'public.wallet_bindings', 'INSERT'),
  'service_role (relayer) can still read and write wallet_bindings'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.wallet_bindings', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.wallet_bindings', 'UPDATE'),
  'authenticated clients cannot insert or update wallet_bindings'
);

SELECT * FROM finish();

ROLLBACK;
