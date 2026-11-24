BEGIN;

SELECT plan(4);

-- Integration test the authenticated RPC against the real users and binding
-- tables. Fixtures are rolled back at the end of the test.
INSERT INTO auth.users (id, aud, role, email, encrypted_password, email_confirmed_at)
VALUES (
  '23300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'wallet-replacement-233@example.test', '', NOW()
);

INSERT INTO users (auth_user_id, wallet_address, cpay_id)
VALUES (
  '23300000-0000-4000-8000-000000000001',
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  'cpay-keep-this-id'
);

INSERT INTO wallet_bindings (auth_user_id, wallet_address, is_active)
VALUES (
  '23300000-0000-4000-8000-000000000001',
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', TRUE
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '23300000-0000-4000-8000-000000000001', TRUE);

SELECT is(
  (SELECT cpay_id FROM replace_own_wallet_binding('GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB') LIMIT 1),
  'cpay-keep-this-id',
  'wallet replacement keeps the existing C-Pay ID'
);

SELECT is(
  (SELECT wallet_address FROM users WHERE auth_user_id = auth.uid()),
  'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  'users row points to the replacement wallet'
);

SELECT is(
  (SELECT count(*)::INTEGER FROM wallet_bindings
   WHERE auth_user_id = auth.uid() AND is_active
     AND wallet_address = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'),
  1,
  'only the replacement wallet binding is active'
);

SELECT is(
  (SELECT is_active FROM wallet_bindings
   WHERE auth_user_id = auth.uid()
     AND wallet_address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'),
  FALSE,
  'old wallet binding is inactive'
);

SELECT * FROM finish();
ROLLBACK;
