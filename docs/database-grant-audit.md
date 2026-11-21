# Database grant audit (#125)

Every privilege statement that the retired `App/supabase_schema.sql` issued, checked against the state the migration chain leaves standing. The schema file was deleted in #102 (R-2). Its content survives verbatim as `supabase/migrations/20260827000000_initial_schema.sql`, so the line numbers below refer to that migration. The final state is enforced by `supabase/tests/database/client_grants.test.sql`.

**Supabase default privileges:** in the `public` schema, Supabase grants `ALL` on new tables and `EXECUTE` on new functions to `anon`, `authenticated` and `service_role`. Because of this, the schema file's `REVOKE ... FROM PUBLIC` never removed `anon`'s access, and any table without an explicit revoke is fully granted to both client roles. RLS was the only thing standing between those tables and the clients.

## Functions

| Object | Schema file grant | State before this change | Final state (`20261017000001`) |
|---|---|---|---|
| `get_public_merchant_by_id(UUID)` | `:443` EXECUTE → authenticated (anon via default) | Dropped by `20260828000001:67` | Drop re-asserted. Does not exist. |
| `get_public_merchant_by_address(TEXT)` | `:444` EXECUTE → authenticated (anon via default) | Dropped `:68` | Drop re-asserted. Does not exist. |
| `get_own_merchant_by_wallet(TEXT)` | `:446` EXECUTE → authenticated (anon via default) | Dropped `:69` | Drop re-asserted. Does not exist. |
| `refresh_merchant_totals(UUID)` | none (default: anon, authenticated) | Dropped `:70` | Drop re-asserted. Does not exist. |
| `update_merchant_totals_from_transaction()` | none (trigger fn) | Dropped `:71` | Drop re-asserted, along with its trigger. |
| `resolve_cpay_id(TEXT)` | `:442` → authenticated (anon via default) | Redefined users-only; **anon still allowed** | authenticated only. Users-only body re-asserted, because the schema-file body also returned merchant rows. |
| `get_public_wallet_profile(TEXT)` | `:441` → authenticated (anon via default) | **anon could map wallet → C-Pay ID / name** | authenticated only |
| `current_wallet_address()` | `:445` → authenticated (anon via default) | anon allowed | authenticated only |
| `upsert_own_profile(TEXT, TEXT, BOOLEAN)` | n/a (added by `20261121000001`, #160) | n/a | authenticated only. Creates or updates the caller's `users` row. It takes the wallet from the caller's active `wallet_bindings` row and the email from the JWT. |
| `set_row_auth_user_id()`, `update_updated_at_column()` | none | Trigger functions; cannot be called via RPC | Unchanged (excluded from the RPC audit) |

## Tables

| Table | Schema file grant | State before this change | Final state |
|---|---|---|---|
| `merchant_contact_verifications` | `:603` SELECT, INSERT, UPDATE → authenticated | Dropped by `20260828000001:92` | Absent. On a schema-file deployment it is kept for the data-preserving drop, but `REVOKE ALL` from client roles leaves it not client-writable. |
| `merchants`, `merchant_qr_codes` | none (default ALL) + client RLS | Dropped `:93-94` | Same as above: absent, or revoked from every client role. |
| `wallet_bindings` | n/a (added by `20260827000001`) | **Client INSERT/UPDATE policies + default grants** | SELECT only for authenticated. The relayer (service_role) is the only writer. |
| `users` | none (default ALL) | anon ALL (RLS-blocked); authenticated DELETE/TRUNCATE | anon none; authenticated SELECT, plus column-level UPDATE on `display_name`, `profile_photo_url`, `biometric_enabled` only (`20261121000001`, #160). Rows are created by `upsert_own_profile()`. |
| `wallet_backups` | `:583` SELECT, INSERT, UPDATE, DELETE → authenticated | + anon ALL and TRUNCATE via default | anon none; authenticated keeps its RLS-scoped CRUD |
| `transactions` | none (default ALL) | Locked by `20260829000001` / `20260831000001`; REFERENCES, TRIGGER left | authenticated SELECT only |
| `add_money_claims`, `relayer_idempotency_keys`, `contract_intent_cache` | `:558-560` REVOKE ALL from clients | Unchanged | Re-asserted. service_role only. |
| `ingest_state`, `payment_records` | n/a | REVOKE ALL from clients | Re-asserted. service_role only. |

## Findings beyond the merchant functions

1. **`wallet_bindings` was client-writable.** The relayer treats this table as the authority for wallet ownership (`resolveUserWallets` / `resolveWalletOwner` in `relayer-service/server.js`). Any signed-in user could `POST /rest/v1/wallet_bindings` with someone else's wallet address and pass `requireWalletOwnership` for it, skip the `maxSponsoredAccountsPerUser` cap, or make the real owner's `/accounts/prepare` fail. The app never writes this table; only the relayer does, using the service-role key.
2. **anon could call every SECURITY DEFINER RPC**, so the public anon key alone was enough to enumerate wallet → C-Pay ID / display name.
3. **TRUNCATE** (which ignores RLS) was held by `authenticated` on `users`, `wallet_backups` and `wallet_bindings`.

## Rollback

`supabase/rollbacks/20260828000001_drop_merchant_schema_rollback.sql` used to re-grant the three merchant RPCs to `authenticated`. It now restores structure and data for `service_role` only, and revokes all client privileges on the merchant tables and functions. Note that its `resolve_cpay_id` body still unions merchants, by design, since it reverts that migration.

## Not changed here (follow-ups)

- ~~`users_update_own` lets a user change their own `wallet_address`~~: fixed by `20261121000001_users_immutable_identity.sql` (#160). That migration adds column-level grants, the `upsert_own_profile()` RPC, a unique `lower(cpay_id)` index, and makes `current_wallet_address()` require an active binding.
- `contract_intent_cache` is no longer referenced by the relayer and can be dropped.

## Operating on an existing deployment

`supabase db push` applies `20261017000001_client_grant_audit.sql`. To confirm afterwards, run `supabase test db` against a local replay, or run the queries in `client_grants.test.sql` against the project. Specifically, `has_table_privilege('authenticated', ...)` / `has_function_privilege('anon', ...)` must match the allowlists above, and `to_regclass('public.merchants')` should be `NULL` once `20260828000001` has run.
