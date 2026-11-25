# C-Pay relayer

Backend service that sponsors Stellar account setup, submits fee-bump payments, and runs the Horizon ledger ingest worker.

## Required configuration

```env
STELLAR_NETWORK=testnet
SPONSOR_SECRET_KEY=S...
DISTRIBUTION_SECRET_KEY=S...
USDC_ASSET_ISSUER=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5
```

`USDC_ASSET_ISSUER` must match Circle's canonical issuer for the selected network. C-Pay has no asset-issuer key and cannot mint USDC. The distribution account must establish a USDC trustline and obtain testnet USDC from Circle's faucet.

- `STELLAR_NETWORK`: `testnet` or `public`
- `STELLAR_HORIZON_URL`: Horizon endpoint
- `STELLAR_NETWORK_PASSPHRASE`: network passphrase
- `CPINR_ASSET_CODE`: `CPINR`
- `CPINR_ASSET_ISSUER`: issuer public key from blockchain setup
- `SPONSOR_SECRET`: secret seed for the account that sponsors reserves and pays fees
- `DISTRIBUTION_SECRET`: secret seed for the hot distribution account
- `RELAYER_AUTH_REQUIRED`: defaults to `true`; it may be set to `false` only when `NODE_ENV=development`
- `MAX_SPONSORED_ACCOUNTS_PER_USER`: reserve-sponsorship budget per user (default: `5`). Sponsored accounts start with `0` XLM; the sponsor pays only account/trustline reserves and fee-bump fees, never a withdrawable balance.
- `RELAYER_ADMIN_TOKEN`: required operator credential for `/health/detailed` and `/ingest/health`, sent as `X-Admin-Token`
- `LOW_BALANCE_CHECK_INTERVAL_MS`: interval for background low-balance alert checks (default: `300000`)
- `SUPABASE_JWT_SECRET`: optional legacy HS256 token verification; when omitted, the Supabase Auth API validates tokens
- `SUPABASE_URL`: required with `SUPABASE_SERVICE_ROLE_KEY` whenever `RELAYER_AUTH_REQUIRED=true`
- `SUPABASE_SERVICE_ROLE_KEY`: required with `SUPABASE_URL` whenever `RELAYER_AUTH_REQUIRED=true`
- `ENABLE_TESTNET_FAUCET`: legacy testnet-only escape hatch; defaults to `false` and is ignored on the public network
- `LEDGER_INGEST_ENABLED`: `true` to enable background Horizon payment operation ingestion
- `INGEST_POLL_INTERVAL_MS`: poll interval in ms (default: `5000`)
- `INGEST_PENDING_TIMEOUT_MS`: timeout after which unconfirmed pending transactions are marked failed (default: `300000`)

Keep issuer secrets offline. The relayer needs sponsor and capped distribution secrets for Stellar payments.
With authentication enabled, startup also probes `wallet_bindings` and exits before
listening if the table is missing or unreachable. Supabase-free development is
available only with `RELAYER_AUTH_REQUIRED=false`.

Add Money always requires Supabase persistence, including in auth-disabled testnet
development. The relayer acquires a database lock and persists the cooldown claim
before submitting the Stellar payment; database lookup or write failures return a
retryable `503` and do not submit funds.

## Endpoints

- `GET /`: Minimal service identifier and health check reference (route enumeration disabled)
- `GET /health`: Unauthenticated minimal liveness probe (`{ "status": "ok" }`)
- `GET /health/detailed`: Operator-token-only detailed health check including account balances and ingest status
- `GET /ingest/health`: Operator-token-only ingest worker health and sanitized lag metrics
- `GET /account/:accountId/status`: Authenticated wallet readiness check
- `GET /account/:accountId/balance`: Authenticated wallet USDC balance check
- `POST /accounts/prepare`: Authenticated prepared transaction creation
- `POST /accounts/submit`: Authenticated user-signed transaction submission
- `POST /payments/submit`: Authenticated sponsored payment submission
- `POST /add-money`: Authenticated testnet faucet distribution
- `GET /tx/:hash`: Authenticated, rate-limited Horizon transaction status lookup. Returns `success`, `failed` (with `result_codes` when available), or `not_found`; a missing hash is never reported as pending.

## Multi-Instance Architecture & Coordination

The relayer is designed to run behind a load balancer with multiple concurrent instances behaving identically to one:

1. **Distributed Add Money Lock**: Add Money requests are serialized across all instances via Supabase `relayer_idempotency_keys` (`key = add-money-user:${authUserId}`). Concurrent requests for the same user on different instances are rejected with `429 ADD_MONEY_IN_FLIGHT` via PostgreSQL unique constraint violation (`23505`). If an instance crashes while holding a lock, subsequent requests detect expired locks and assume ownership.
2. **Cluster-Wide Alert Deduplication**: Low-balance alerts (`ALERT_WEBHOOK_URL`) use `relayer_idempotency_keys` (`key = alert:low-balance`) with a distributed TTL window (`LOW_BALANCE_ALERT_WINDOW_MS`, default: 1 hour). Alerts fire at most once per window across the entire cluster, survive restarts, and automatically reset when account balances recover above threshold.
3. **Stateless Service**: `server.js` avoids unbounded module-level memory state. All caches are strictly bounded with explicit eviction policies.

## In-Memory Cache Eviction Policies

Every remaining in-memory cache is bounded with an explicit eviction policy:

1. **`walletUserCache` (Ingest Worker)**:
   - **Type**: `BoundedLruMap` (Least Recently Used).
   - **Capacity**: Configurable via `INGEST_WALLET_CACHE_MAX_SIZE` (default: 5,000 entries).
   - **Eviction**: When capacity is reached, the least recently accessed wallet mapping is evicted upon new insertion.
   - **Resolution**: Initial cache pre-warming is capped at capacity limit; cache misses resolve on demand via `users` table queries and populate the LRU cache.
2. **`preparedAccountTransactions` (Relayer Service)**:
   - **Type**: Bounded TTL / FIFO Object map.
   - **Capacity**: 10,000 entries (`MAX_PREPARED_ACCOUNT_TRANSACTIONS`).
   - **TTL**: 5 minutes (`PREPARED_ACCOUNT_TRANSACTION_TTL_MS`).
   - **Eviction**: Expired entries are pruned on every access; oldest entries are evicted if capacity exceeds 10,000.
3. **`activeAddMoneyUserLocks` (In-Memory Fallback)**:
   - **Type**: Bounded TTL / FIFO Object map (used only when Supabase persistence is not configured).
   - **Capacity**: 1,000 entries (`MAX_ACTIVE_ADD_MONEY_USER_LOCKS`).
   - **TTL**: Transaction timeout (`TRANSACTION_TIMEOUT_SECONDS * 1000 + 5000`).
   - **Eviction**: Expired entries are pruned on every acquisition; oldest entries are evicted if capacity exceeds 1,000.

## Ledger Ingest Worker Instance Model

The Ingest Worker continuously streams/polls Horizon payment operations:
1. **Active-Standby Leader Election**: Backed by `ingest_state` lease in Supabase (`key = ingest_leader`). Only the elected leader instance actively streams Horizon operations and advances the cursor, preventing split-brain cursor collisions or duplicate ingestion across multiple relayer instances. Standby instances monitor the lease heartbeat and automatically promote to leader if the current leader fails to renew within `INGEST_LEADER_LEASE_TTL_MS` (default: 30 seconds).
2. **Deployment Modes**: In containerized deployments behind a load balancer, set `LEDGER_INGEST_ENABLED=false` on stateless web/API nodes and run a single dedicated background worker with `LEDGER_INGEST_ENABLED=true`. When running multiple instances with `LEDGER_INGEST_ENABLED=true`, the leader lease ensures only one active worker streams at a time.
3. **Resumable Ingestion**: Uses a cursor persisted in Supabase `ingest_state` table to resume without scanning from genesis.
4. **Idempotency**: Upserts into `transactions` with key `(tx_hash, op_index)`. Replaying the same ledger range causes no duplicates.
5. **Reconciliation**: Matches chain records against optimistic pending transactions and marks timed-out pending rows as failed.
6. **Lag Metrics**: Calculates and exposes ledger lag (`latestNetworkLedger - lastIngestedLedger`) via `GET /ingest/health` and `GET /health/detailed`.

## Production Notes

- Put the relayer behind HTTPS.
- Restrict `CORS_ORIGIN` to app domains/builds. `*` is rejected when `NODE_ENV=production`.
- Configure Supabase token verification so only authenticated app users can spend sponsored relayer resources. The relayer no longer accepts `EXPO_PUBLIC_SUPABASE_URL` as a server URL.
- `/accounts/prepare` refuses unauthenticated sponsorship on the public network, even when a development configuration disables general user auth.
- Set a strong `RELAYER_ADMIN_TOKEN` and provide it only to trusted monitoring systems; the detailed health endpoints return `403` without it, even when user authentication is disabled.
- Leave `ENABLE_TESTNET_FAUCET=false`. Production money-in requires a licensed on-ramp partner.
- Rotate `SPONSOR_SECRET` and `DISTRIBUTION_SECRET` through infrastructure secrets.
- Keep `ADD_MONEY_AMOUNT`, `MAX_PAYMENT_AMOUNT`, and `ADD_MONEY_COOLDOWN_MS` policy controlled.
- Configure `ALERT_WEBHOOK_URL` for low XLM or low CPINR inventory alerts.
