BEGIN;

SELECT plan(18);

SELECT has_table(
  'public',
  'transactions',
  'transactions exists after replaying the complete migration chain'
);

SELECT hasnt_table(
  'public',
  'merchants',
  'the retired merchants table is absent'
);

SELECT hasnt_column(
  'public',
  'transactions',
  'merchant_id',
  'transactions no longer contains merchant_id'
);

SELECT has_table(
  'public',
  'wallet_bindings',
  'wallet_bindings exists after a clean provision'
);

SELECT has_column(
  'public',
  'add_money_claims',
  'auth_user_id',
  'add_money_claims is keyed by authenticated user'
);

SELECT col_is_null(
  'public',
  'relayer_idempotency_keys',
  'response',
  'persisted relayer locks can store an in-flight NULL response'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('merchants', 'merchant_qr_codes', 'merchant_contact_verifications')
  ),
  'no merchant table survives a clean provision'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_proc.proname IN (
        'get_public_merchant_by_id',
        'get_public_merchant_by_address',
        'get_own_merchant_by_wallet',
        'refresh_merchant_totals',
        'update_merchant_totals_from_transaction'
      )
  ),
  'no merchant function survives a clean provision'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%merchant%'
  ),
  'the transaction type CHECK no longer permits merchant values'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'transactions_select_participant'
      AND cmd = 'SELECT'
  ),
  'the participant SELECT policy exists'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transactions'
      AND policyname = 'transactions_select_participant'
      AND qual ILIKE '%merchant%'
  ),
  'the participant SELECT policy references no merchant object'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.transactions', 'INSERT'),
  'the anon role cannot INSERT transactions'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.transactions', 'INSERT'),
  'an authenticated anon-key client cannot INSERT transactions'
);

-- Participant isolation & client lockdown tests (#1, #123)
INSERT INTO auth.users (id, email)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'user1@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'user2@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'user3@test.com');

INSERT INTO public.users (auth_user_id, wallet_address, email)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'GA_USER_1_WALLET_ADDR', 'user1@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'GB_USER_2_WALLET_ADDR', 'user2@test.com'),
  ('33333333-3333-3333-3333-333333333333', 'GC_USER_3_WALLET_ADDR', 'user3@test.com');

-- current_wallet_address() only honours relayer-written bindings (#160).
INSERT INTO public.wallet_bindings (auth_user_id, wallet_address)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'GA_USER_1_WALLET_ADDR'),
  ('22222222-2222-2222-2222-222222222222', 'GB_USER_2_WALLET_ADDR'),
  ('33333333-3333-3333-3333-333333333333', 'GC_USER_3_WALLET_ADDR');

INSERT INTO public.transactions (tx_hash, from_address, to_address, amount, status)
VALUES
  ('tx_user1_to_user2', 'GA_USER_1_WALLET_ADDR', 'GB_USER_2_WALLET_ADDR', 10.0, 'success'),
  ('tx_user2_to_user3', 'GB_USER_2_WALLET_ADDR', 'GC_USER_3_WALLET_ADDR', 25.0, 'success');

-- 1. As authenticated user1:
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
  'SELECT tx_hash FROM transactions ORDER BY tx_hash',
  ARRAY['tx_user1_to_user2'],
  'a user can only SELECT transactions where they are participant'
);

SELECT is_empty(
  'SELECT tx_hash FROM transactions WHERE tx_hash = ''tx_user2_to_user3''',
  'a user cannot SELECT another user''s transaction rows'
);

SELECT throws_ok(
  'INSERT INTO transactions (tx_hash, from_address, to_address, amount, status) VALUES (''rogue_tx'', ''GA_USER_1_WALLET_ADDR'', ''GB_USER_2_WALLET_ADDR'', 50.0, ''success'')',
  '42501',
  NULL,
  'authenticated user cannot INSERT into transactions'
);

-- 2. As anon role:
SET LOCAL ROLE anon;

SELECT throws_ok(
  'SELECT * FROM transactions',
  '42501',
  NULL,
  'anon role cannot SELECT from transactions'
);

SELECT throws_ok(
  'INSERT INTO transactions (tx_hash, from_address, to_address, amount, status) VALUES (''anon_tx'', ''GA_USER_1_WALLET_ADDR'', ''GB_USER_2_WALLET_ADDR'', 50.0, ''success'')',
  '42501',
  NULL,
  'anon role cannot INSERT into transactions'
);

SELECT * FROM finish();

ROLLBACK;
