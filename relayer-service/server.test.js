/**
 * Ownership authorization tests for the C-Pay relayer.
 *
 * These tests verify that when auth is enabled the relayer:
 *   - Allows requests whose wallet belongs to the authenticated user.
 *   - Returns 403 WALLET_OWNERSHIP_DENIED when the wallet belongs to another user.
 *   - Skips ownership checks when Supabase persistence is not configured (no service-role key).
 *   - Skips ownership checks when auth is disabled (RELAYER_AUTH_REQUIRED=false).
 *
 * External network calls (Stellar Horizon, Supabase) are fully mocked so no real
 * credentials or network access are required.
 */

'use strict';

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Build a response object compatible with supabaseRestRequest and verifySupabaseTokenWithAuthApi.
 * supabaseRestRequest calls response.text() then JSON.parse().
 * verifySupabaseTokenWithAuthApi calls response.json().
 */
function makeResponse(ok, status, data) {
  const body = JSON.stringify(data);
  return {
    ok,
    status,
    text: async () => body,
    json: async () => data,
  };
}

/**
 * Build a minimal JWT-shaped Bearer token whose payload contains `sub`.
 * The signature is a placeholder; actual verification is mocked.
 */
function makeBearerToken(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `Bearer ${header}.${payload}.sig`;
}

// ─── test wallets ────────────────────────────────────────────────────────────

// Real Ed25519 public keys so assertAccountId passes without mocking Stellar.
const WALLET_A = 'GDUXXBTQHTSNMHFKO2BNUQNQUCVIOKEMMKD5AWIFYBKOAVMFHBUP3RYJ';
const WALLET_B = 'GCYJAA6M7KTAOXPYVHFVOWUIGM6I3DLER24WAWY7OOUDWYHYDVEST4TZ';

// Supabase user IDs.
const USER_A = 'user-a-uid';
const USER_B = 'user-b-uid';

// ─── mock fetch ──────────────────────────────────────────────────────────────

/**
 * The server uses the global `fetch` API for Supabase REST and Auth API calls.
 * We replace it with a controllable mock before the server module is loaded.
 *
 * Route table (called in order):
 *   /auth/v1/user      → verifySupabaseTokenWithAuthApi (sub from token header)
 *   /rest/v1/wallet_bindings?... → startup probe and ownership resolution
 */
function buildFetchMock({
  userWallets = {},
  walletOwners = {},
  failOwnershipLookup = false,
  failBindingWrite = false,
  walletBindingsUnavailable = false,
  failCooldownLookup = false,
  failDailyCapLookup = false,
  failClaimWrite = false,
  failLockWrite = false,
  failPaymentRecordsLookup = false,
  failPaymentRecordsWrite = false,
  database,
  events = [],
} = {}) {
  const persistence = database || { locks: new Map(), claims: [], paymentRecords: [] };
  return async function mockFetch(url, options) {
    const urlStr = String(url);

    // ── Auth API ─────────────────────────────────────────────────────────────
    if (urlStr.includes('/auth/v1/user')) {
      const authHeader = (options && options.headers && options.headers['Authorization']) || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const [, encodedPayload] = token.split('.');
      let sub = null;
      try {
        sub = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString()).sub;
      } catch (_) { /* ignored */ }

      if (!sub) {
        return makeResponse(false, 401, { msg: 'Invalid token' });
      }
      return makeResponse(true, 200, { id: sub, aud: 'authenticated', role: 'authenticated' });
    }

    // ── wallet_bindings table ─────────────────────────────────────────────────
    if (urlStr.includes('/rest/v1/wallet_bindings')) {
      const parsed = new URL(urlStr);
      const method = (options && options.method) || 'GET';
      if (method === 'POST') {
        if (failBindingWrite) {
          return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
        }
        const binding = JSON.parse(options.body);
        const wallets = userWallets[binding.auth_user_id] || (userWallets[binding.auth_user_id] = []);
        if (!wallets.includes(binding.wallet_address)) wallets.push(binding.wallet_address);
        return makeResponse(true, 201, null);
      }
      const authUserIdFilter = parsed.searchParams.get('auth_user_id') || '';
      if (authUserIdFilter) {
        const uid = authUserIdFilter.replace(/^eq\./, '');
        const wallets = (userWallets[uid] || []).map(w => ({ wallet_address: w }));
        return makeResponse(true, 200, wallets);
      }
      const walletAddressFilter = parsed.searchParams.get('wallet_address') || '';
      if (walletAddressFilter) {
        const addr = walletAddressFilter.replace(/^eq\./, '');
        for (const [uid, wallets] of Object.entries(userWallets)) {
          if (wallets.includes(addr)) {
            return makeResponse(true, 200, [{ auth_user_id: uid }]);
          }
        }
        return makeResponse(true, 200, []);
      }
      return makeResponse(true, 200, []);
    }

    // ── persisted relayer locks ────────────────────────────────────────────────
    if (urlStr.includes('/rest/v1/relayer_idempotency_keys')) {
      const parsed = new URL(urlStr);
      const method = (options && options.method) || 'GET';
      const keyFilter = parsed.searchParams.get('key') || '';
      const key = keyFilter.replace(/^eq\./, '');

      if (method === 'POST') {
        if (failLockWrite) {
          return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
        }
        const row = JSON.parse(options.body);
        events.push(`lock:${row.key}`);
        if (persistence.locks.has(row.key)) {
          return makeResponse(false, 409, {
            code: '23505',
            message: 'duplicate key value violates unique constraint',
          });
        }
        persistence.locks.set(row.key, row);
        return makeResponse(true, 201, null);
      }

      if (method === 'GET') {
        const row = persistence.locks.get(key);
        return makeResponse(true, 200, row ? [{ response: row.response, expires_at: row.expires_at }] : []);
      }

      if (method === 'PATCH') {
        const row = persistence.locks.get(key);
        if (row) {
          Object.assign(row, JSON.parse(options.body));
        }
        return makeResponse(true, 204, null);
      }

      if (method === 'DELETE') {
        if (key) {
          persistence.locks.delete(key);
        }
        return makeResponse(true, 204, null);
      }
    }

    // ── Add Money claims ───────────────────────────────────────────────────────
    if (urlStr.includes('/rest/v1/add_money_claims')) {
      const parsed = new URL(urlStr);
      const method = (options && options.method) || 'GET';
      const select = parsed.searchParams.get('select') || '';

      if (method === 'GET' && select === 'next_available_at') {
        if (failCooldownLookup) {
          return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
        }
        return makeResponse(true, 200, []);
      }

      if (method === 'GET' && select === 'amount,claimed_at') {
        if (failDailyCapLookup) {
          return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
        }
        return makeResponse(true, 200, persistence.claims.map(row => ({
          amount: row.amount,
          claimed_at: row.claimed_at,
        })));
      }

      if (method === 'POST') {
        events.push('claim:reserve');
        if (failClaimWrite) {
          return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
        }
        const row = JSON.parse(options.body);
        persistence.claims.push(row);
        return makeResponse(true, 201, [row]);
      }

      if (method === 'PATCH') {
        const id = (parsed.searchParams.get('id') || '').replace(/^eq\./, '');
        const row = persistence.claims.find(claim => claim.id === id);
        if (row) {
          Object.assign(row, JSON.parse(options.body));
          events.push('claim:settle');
        }
        return makeResponse(true, 200, row ? [row] : []);
      }
    }

    // ── Payment records ────────────────────────────────────────────────────────
    if (urlStr.includes('/rest/v1/payment_records')) {
      const parsed = new URL(urlStr);
      const method = (options && options.method) || 'GET';

      if (failPaymentRecordsLookup) {
        return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
      }

      if (method === 'GET') {
        const records = (persistence.paymentRecords || []).map(r => ({
          amount: r.amount,
          created_at: r.created_at,
          wallet_address: r.wallet_address,
          auth_user_id: r.auth_user_id,
        }));
        return makeResponse(true, 200, records);
      }

      if (method === 'POST') {
        if (failPaymentRecordsWrite) {
          return makeResponse(false, 503, { code: 'PGRST000', message: 'database unavailable' });
        }
        const row = JSON.parse(options.body);
        if (!persistence.paymentRecords) persistence.paymentRecords = [];
        persistence.paymentRecords.push(row);
        return makeResponse(true, 201, [row]);
      }

      if (method === 'DELETE') {
        return makeResponse(true, 204, null);
      }
    }

    // Fallback – should not be reached in these tests.
    return makeResponse(false, 500, { error: 'Unexpected fetch: ' + urlStr });
  };
}

// ─── load server ─────────────────────────────────────────────────────────────

let app;
const activeModuleServers = new Set();

async function closeActiveModuleServers() {
  const servers = Array.from(activeModuleServers);
  activeModuleServers.clear();
  await Promise.all(servers.map(serverInstance => new Promise((resolve) => {
    if (typeof serverInstance.closeAllConnections === 'function') {
      serverInstance.closeAllConnections();
    }
    serverInstance.close(resolve);
  }).catch(() => {})));
}

/**
 * Reload the server module with specific environment variables.
 * Jest module isolation is used so each describe block can control env.
 */
async function loadServer(env = {}) {
  const mod = await loadServerModule(env);
  app = mod.app;
  return app;
}

async function loadServerModule(env = {}, { closeExisting = true } = {}) {
  if (closeExisting) {
    await closeActiveModuleServers();
  }

  // Reset module registry to pick up new env values.
  jest.resetModules();

  // Defaults that satisfy loadConfig() without real secrets.
  const defaultEnv = {
    STELLAR_NETWORK: 'testnet',
    ALLOW_HTTP_HORIZON: 'true',
    ALLOW_CUSTOM_HORIZON: 'true',
    STELLAR_HORIZON_URL: 'http://localhost:9999/horizon',
    ALLOW_HTTP_SOROBAN_RPC: 'true',
    ALLOW_CUSTOM_SOROBAN_RPC: 'true',
    SOROBAN_RPC_URL: 'http://localhost:9999/soroban',
    STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    SPONSOR_SECRET: 'SCTIPFZ5KVBOENXTZK3FQPIGR5H73R5HE2MNZ4AXA7CA7JEEXUG5AF5G',
    DISTRIBUTION_SECRET: 'SBMJSD66AECV4CKZWTHXCH4EDZ5CRAZNNZL4OQP6IQAR4YLQ6HE5QJDM',
    USDC_ASSET_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    SUPABASE_URL: 'http://localhost:9999/supabase',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    LEDGER_INGEST_ENABLED: 'false',
    RELAYER_AUTH_REQUIRED: 'true',
    ENABLE_TESTNET_FAUCET: 'true',
    LEDGER_INGEST_ENABLED: 'false',
    PORT: '0',
  };

  const { __fetchMock, ...envOverrides } = env;
  Object.assign(process.env, defaultEnv, envOverrides);

  // Mount our fetch mock onto the global so the module picks it up.
  const fetchImpl = __fetchMock || buildFetchMock();
  global.fetch = fetchImpl;

  const mod = require('./server.js');
  app = mod.app;
  activeModuleServer = mod.server;
  activeIngestWorker = mod.ingestWorker;

  return mod;
}

let activeIngestWorker = null;

// ─── request helper ──────────────────────────────────────────────────────────

const http = require('http');
const StellarSdk = require('@stellar/stellar-sdk');

const TEST_SPONSOR_SECRET = 'SCTIPFZ5KVBOENXTZK3FQPIGR5H73R5HE2MNZ4AXA7CA7JEEXUG5AF5G';

function postJson(appInstance, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      method: 'POST',
      path,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };

    const testServer = http.createServer(appInstance);
    testServer.listen(0, '127.0.0.1', () => {
      const port = testServer.address().port;
      const req = http.request({ ...options, host: '127.0.0.1', port }, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          testServer.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (err) => { testServer.close(); reject(err); });
      req.write(payload);
      req.end();
    });
  });
}

function getJson(appInstance, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const testServer = http.createServer(appInstance);
    testServer.listen(0, '127.0.0.1', () => {
      const port = testServer.address().port;
      const req = http.request({
        method: 'GET',
        path,
        host: '127.0.0.1',
        port,
        headers,
      }, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          testServer.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (_) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (error) => {
        testServer.close();
        reject(error);
      });
      req.end();
    });
  });
}

// ─── test suites ─────────────────────────────────────────────────────────────

afterEach(async () => {
  if (activeIngestWorker && typeof activeIngestWorker.stop === 'function') {
    activeIngestWorker.stop();
    activeIngestWorker = null;
  }

  // Close the active module server to free the port.
  if (activeModuleServer) {
    await new Promise((resolve) => {
      if (typeof activeModuleServer.closeAllConnections === 'function') {
        activeModuleServer.closeAllConnections();
      }
      activeModuleServer.close(resolve);
    }).catch(() => {});
    activeModuleServer = null;
  }

  // Clean up env additions to avoid bleed between suites.
  const ADDED_KEYS = [
    'STELLAR_NETWORK', 'ALLOW_HTTP_HORIZON', 'ALLOW_CUSTOM_HORIZON',
    'STELLAR_HORIZON_URL', 'ALLOW_HTTP_SOROBAN_RPC', 'ALLOW_CUSTOM_SOROBAN_RPC',
    'SOROBAN_RPC_URL', 'STELLAR_NETWORK_PASSPHRASE', 'SPONSOR_SECRET',
    'DISTRIBUTION_SECRET', 'CPINR_ASSET_ISSUER', 'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY', 'RELAYER_AUTH_REQUIRED', 'ENABLE_ADD_MONEY',
    'PORT', 'LEDGER_INGEST_ENABLED',
  ];
  ADDED_KEYS.forEach(k => delete process.env[k]);
  jest.resetModules();
});

// ── /accounts/prepare ────────────────────────────────────────────────────────

describe('/accounts/prepare ownership', () => {
  let expressApp;

  beforeEach(async () => {
    expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: {
          [USER_A]: [WALLET_A],
          [USER_B]: [WALLET_B],
        },
      }),
    });
  });

  it('allows the authenticated owner to prepare their own account', async () => {
    // The Stellar Horizon call inside /accounts/prepare will fail (no real server),
    // but only after the ownership check passes. We verify status is NOT 403.
    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_A },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).not.toBe(403);
    expect(body.code).not.toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('blocks user A from preparing user B\'s account', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_B },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(403);
    expect(body.code).toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('aborts account sponsorship when a new wallet binding cannot be persisted', async () => {
    expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        failBindingWrite: true,
      }),
    });

    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_B },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      code: 'WALLET_BINDING_FAILED',
      retryable: true,
    }));
  });
});

// ── /add-money ───────────────────────────────────────────────────────────────

async function loadAccountSubmissionServer(userWallets) {
  const mod = await loadServerModule({
    __fetchMock: buildFetchMock({ userWallets }),
  });
  const sponsorKeypair = StellarSdk.Keypair.fromSecret(TEST_SPONSOR_SECRET);
  const sponsorAccount = new StellarSdk.Account(sponsorKeypair.publicKey(), '1');
  sponsorAccount.balances = [{ asset_type: 'native', balance: '1000' }];

  mod.testHooks.stellarServer.loadAccount = async (accountId) => {
    if (accountId === sponsorKeypair.publicKey()) return sponsorAccount;
    const error = new Error('Account not found');
    error.response = { status: 404 };
    throw error;
  };
  mod.testHooks.stellarServer.submitTransaction = async (transaction) => ({
    hash: transaction.hash().toString('hex'),
    ledger: 1,
  });
  return mod;
}

describe('/accounts/submit prepared setup authorization', () => {
  const passphrase = 'Test SDF Network ; September 2015';

  it('allows an authenticated new wallet to prepare, sign, and submit its setup transaction', async () => {
    const newWallet = StellarSdk.Keypair.random();
    const mod = await loadAccountSubmissionServer({ [USER_B]: [WALLET_B] });
    const prepare = await postJson(
      mod.app,
      '/accounts/prepare',
      { accountId: newWallet.publicKey() },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(prepare.status).toBe(200);
    expect(prepare.body.alreadyReady).toBe(false);
    const signedTransaction = StellarSdk.TransactionBuilder.fromXDR(prepare.body.xdr, passphrase);
    signedTransaction.sign(newWallet);

    const submit = await postJson(
      mod.app,
      '/accounts/submit',
      { signedXdr: signedTransaction.toXDR() },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe('success');
  });

  it('rejects a prepared setup transaction when another authenticated user submits it', async () => {
    const newWallet = StellarSdk.Keypair.random();
    const mod = await loadAccountSubmissionServer({ [USER_B]: [WALLET_B] });
    const prepare = await postJson(
      mod.app,
      '/accounts/prepare',
      { accountId: newWallet.publicKey() },
      { Authorization: makeBearerToken(USER_A) }
    );
    const signedTransaction = StellarSdk.TransactionBuilder.fromXDR(prepare.body.xdr, passphrase);
    signedTransaction.sign(newWallet);

    const submit = await postJson(
      mod.app,
      '/accounts/submit',
      { signedXdr: signedTransaction.toXDR() },
      { Authorization: makeBearerToken(USER_B) }
    );

    expect(submit.status).toBe(403);
    expect(submit.body.code).toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('rejects an arbitrary transaction even when its source wallet belongs to the user', async () => {
    const wallet = StellarSdk.Keypair.random();
    const mod = await loadAccountSubmissionServer({ [USER_A]: [wallet.publicKey()] });
    const arbitraryTransaction = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(wallet.publicKey(), '1'),
      { fee: StellarSdk.BASE_FEE, networkPassphrase: passphrase }
    )
      .addOperation(StellarSdk.Operation.payment({
        destination: WALLET_B,
        asset: StellarSdk.Asset.native(),
        amount: '1',
      }))
      .setTimeout(60)
      .build();
    arbitraryTransaction.sign(wallet);

    const submit = await postJson(
      mod.app,
      '/accounts/submit',
      { signedXdr: arbitraryTransaction.toXDR() },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(submit.status).toBe(403);
    expect(submit.body.code).toBe('WALLET_OWNERSHIP_DENIED');
  });
});

describe('/add-money ownership', () => {
  let expressApp;

  beforeEach(async () => {
    expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
      }),
    });
  });

  it('allows add-money for the authenticated owner\'s wallet', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_A },
      { Authorization: makeBearerToken(USER_A) }
    );

    // Ownership passes; downstream may fail for other reasons (Horizon unreachable),
    // but must not return 403 WALLET_OWNERSHIP_DENIED.
    expect(status).not.toBe(403);
    expect(body.code).not.toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('blocks add-money for a wallet not owned by the authenticated user', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_B },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(403);
    expect(body.code).toBe('WALLET_OWNERSHIP_DENIED');
  });
});

describe('/add-money persistence safety', () => {
  it('returns 503 when the cooldown lookup fails', async () => {
    const database = { locks: new Map(), claims: [] };
    const expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        failCooldownLookup: true,
        database,
      }),
    });

    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_A },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      code: 'ADD_MONEY_PERSISTENCE_UNAVAILABLE',
      retryable: true,
    }));
    expect(database.claims).toHaveLength(0);
  });

  it('returns 503 when the daily cap lookup fails', async () => {
    const database = { locks: new Map(), claims: [] };
    const expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        failDailyCapLookup: true,
        database,
      }),
    });

    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_A },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body.code).toBe('ADD_MONEY_PERSISTENCE_UNAVAILABLE');
    expect(database.claims).toHaveLength(0);
  });

  it('preserves PostgREST status and parsed error code', async () => {
    const mod = await loadServerModule({
      __fetchMock: buildFetchMock({ failLockWrite: true }),
    });

    await expect(mod.testHooks.supabaseRestRequest('relayer_idempotency_keys', {
      method: 'POST',
      body: JSON.stringify({ key: 'test-lock', response: null }),
    })).rejects.toMatchObject({
      status: 503,
      code: 'PGRST000',
      body: { code: 'PGRST000' },
    });
  });

  it('reserves the persisted cooldown before submitting a payment', () => {
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const routeStart = source.indexOf("app.post('/add-money'");
    const routeEnd = source.indexOf("app.get('/tx/:hash'", routeStart);
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeSource.indexOf('await reserveAddMoneyClaim')).toBeGreaterThan(-1);
    expect(routeSource.indexOf('await reserveAddMoneyClaim'))
      .toBeLessThan(routeSource.indexOf('await server.submitTransaction'));
  });

  it('propagates a claim reservation write failure', async () => {
    const database = { locks: new Map(), claims: [] };
    const mod = await loadServerModule({
      __fetchMock: buildFetchMock({ failClaimWrite: true, database }),
    });

    await expect(mod.testHooks.reserveAddMoneyClaim({
      claimId: '00000000-0000-4000-8000-000000000001',
      walletAddress: WALLET_A,
      authUserId: USER_A,
      amount: '100',
      idempotencyKey: '',
      nextAvailableAt: new Date(Date.now() + 60000).toISOString(),
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'ADD_MONEY_PERSISTENCE_UNAVAILABLE',
      retryable: true,
    });
    expect(database.claims).toHaveLength(0);
  });

  it('allows exactly one persisted lock across two relayer instances', async () => {
    const database = { locks: new Map(), claims: [] };
    const fetchMock = buildFetchMock({ database });
    const first = await loadServerModule({ __fetchMock: fetchMock });
    const second = await loadServerModule(
      { __fetchMock: fetchMock },
      { closeExisting: false }
    );

    const results = await Promise.all([
      first.testHooks.acquireAddMoneyUserLock('add-money-user:shared', 60000),
      second.testHooks.acquireAddMoneyUserLock('add-money-user:shared', 60000),
    ]);

    expect(results.map(result => result.acquired).sort()).toEqual([false, true]);
    expect(database.locks.size).toBe(1);
  });

  it('recognizes an idempotency conflict by PostgreSQL code 23505', async () => {
    const database = { locks: new Map(), claims: [] };
    database.locks.set('duplicate-request', {
      key: 'duplicate-request',
      response: null,
    });
    const mod = await loadServerModule({
      __fetchMock: buildFetchMock({ database }),
    });

    await expect(
      mod.testHooks.acquireIdempotencyLock('duplicate-request', 60000)
    ).resolves.toEqual({ acquired: false, response: null });
  });

  it('submits zero grants across two relayer instances when the DB lock fails', async () => {
    const database = { locks: new Map(), claims: [] };
    const fetchMock = buildFetchMock({
      userWallets: { [USER_A]: [WALLET_A] },
      failLockWrite: true,
      database,
    });
    const first = await loadServerModule({ __fetchMock: fetchMock });
    const second = await loadServerModule(
      { __fetchMock: fetchMock },
      { closeExisting: false }
    );

    const responses = await Promise.all([
      postJson(first.app, '/add-money', { accountId: WALLET_A }, {
        Authorization: makeBearerToken(USER_A),
      }),
      postJson(second.app, '/add-money', { accountId: WALLET_A }, {
        Authorization: makeBearerToken(USER_A),
      }),
    ]);

    expect(responses.map(response => response.status)).toEqual([503, 503]);
    expect(responses.every(response => response.body.code === 'ADD_MONEY_PERSISTENCE_UNAVAILABLE')).toBe(true);
    expect(database.claims).toHaveLength(0);
  });
});

// ── auth disabled ─────────────────────────────────────────────────────────────

describe('ownership checks skipped when auth is disabled', () => {
  let expressApp;

  beforeEach(async () => {
    expressApp = await loadServer({
      RELAYER_AUTH_REQUIRED: 'false',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      __fetchMock: buildFetchMock({
        userWallets: {},
      }),
    });
  });

  it('does not return 403 for /add-money when auth is disabled', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_B }
    );

    expect(status).not.toBe(403);
    expect(body.code).not.toBe('WALLET_OWNERSHIP_DENIED');
  });

  it('does not return 403 for /accounts/prepare when auth is disabled', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_B }
    );

    expect(status).not.toBe(403);
    expect(body.code).not.toBe('WALLET_OWNERSHIP_DENIED');
  });
});

// ── fail-closed ownership infrastructure ─────────────────────────────────────

describe('ownership infrastructure failures', () => {
  it('rejects a request when the wallet binding lookup fails', async () => {
    const expressApp = await loadServer({
      __fetchMock: buildFetchMock({ failOwnershipLookup: true }),
    });

    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_A },
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      code: 'WALLET_OWNERSHIP_UNAVAILABLE',
      retryable: true,
    }));
  });

  it('rejects a path-wallet request when the binding lookup fails', async () => {
    const expressApp = await loadServer({
      __fetchMock: buildFetchMock({ failOwnershipLookup: true }),
    });

    const { status, body } = await getJson(
      expressApp,
      `/account/${WALLET_A}/balance`,
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body.code).toBe('WALLET_OWNERSHIP_UNAVAILABLE');
  });

  it('refuses to boot when wallet_bindings is unreachable', async () => {
    await expect(loadServer({
      __fetchMock: buildFetchMock({ walletBindingsUnavailable: true }),
    })).rejects.toThrow(/wallet_bindings/);
    expect(activeModuleServers.size).toBe(0);
  });

  it('refuses to boot without persistence when authentication is enabled', async () => {
    await expect(loadServer({
      RELAYER_AUTH_REQUIRED: 'true',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      SUPABASE_JWT_SECRET: 'test-jwt-secret-that-is-long-enough',
      __fetchMock: buildFetchMock({}),
    })).rejects.toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
    expect(activeModuleServers.size).toBe(0);
  });
});

// ── unauthenticated requests ──────────────────────────────────────────────────

describe('unauthenticated requests are rejected before ownership check', () => {
  let expressApp;

  beforeEach(async () => {
    expressApp = await loadServer({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
      }),
    });
  });

  it('returns 401 when no token is provided to /add-money', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/add-money',
      { accountId: WALLET_A }
    );

    expect(status).toBe(401);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 when no token is provided to /accounts/prepare', async () => {
    const { status, body } = await postJson(
      expressApp,
      '/accounts/prepare',
      { accountId: WALLET_A }
    );

    expect(status).toBe(401);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 when no token is provided to /ingest/health', async () => {
    const { status, body } = await getJson(
      expressApp,
      '/ingest/health'
    );

    expect(status).toBe(401);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 when no token is provided to /tx/:hash', async () => {
    const { status, body } = await getJson(
      expressApp,
      '/tx/0000000000000000000000000000000000000000000000000000000000000000'
    );

    expect(status).toBe(401);
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns minimal service information on GET / without enumerating routes', async () => {
    const { status, body } = await getJson(
      expressApp,
      '/'
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      service: 'C-Pay Stellar Relayer',
      health: '/health',
    });
    expect(body.endpoints).toBeUndefined();
  });
});

// ── Payment transaction limits and velocity enforcement (#114) ───────────────

describe('Payment transaction limits and velocity enforcement (#114)', () => {
  let mod;
  let expressApp;
  let testHooks;
  let persistence;

  beforeEach(async () => {
    persistence = { locks: new Map(), claims: [], paymentRecords: [] };
    mod = await loadServerModule({
      MAX_PAYMENT_AMOUNT: '1000',
      MAX_PAYMENT_DAILY_AMOUNT: '5000',
      MAX_PAYMENT_DAILY_COUNT: '20',
      MAX_PAYMENT_VELOCITY_PER_MINUTE: '10',
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        walletOwners: { [WALLET_A]: USER_A },
        database: persistence,
      }),
    });
    expressApp = mod.app;
    testHooks = mod.testHooks;
  });

  afterAll(async () => {
    await closeActiveModuleServers();
  });

  it('GET /payments/limits returns server-authoritative numbers and remaining quota', async () => {
    persistence.paymentRecords = [
      {
        id: 'rec-1',
        auth_user_id: USER_A,
        wallet_address: WALLET_A,
        amount: '200',
        created_at: new Date().toISOString(),
      },
      {
        id: 'rec-2',
        auth_user_id: USER_A,
        wallet_address: WALLET_A,
        amount: '300',
        created_at: new Date().toISOString(),
      },
    ];

    const { status, body } = await getJson(
      expressApp,
      '/payments/limits',
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(200);
    expect(body.maxAmountPerTransaction).toBe(1000);
    expect(body.maxDailyAmount).toBe(5000);
    expect(body.maxTransactionsPerDay).toBe(20);
    expect(body.maxRequestsPerMinute).toBe(10);
    expect(body.transactionsToday).toBe(2);
    expect(body.amountToday).toBe(500);
    expect(body.remaining).toEqual({
      amount: 4500,
      transactions: 18,
    });
  });

  it('rejects payments exceeding the per-transaction cap (e.g. 1500 > 1000)', async () => {
    await expect(
      testHooks.checkPaymentLimits(WALLET_A, USER_A, '1500')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'PAYMENT_AMOUNT_EXCEEDED',
    });
  });

  it('rejects payment when cumulative daily amount exceeds daily cap (5000)', async () => {
    persistence.paymentRecords = [
      {
        id: 'rec-1',
        auth_user_id: USER_A,
        wallet_address: WALLET_A,
        amount: '4800',
        created_at: new Date().toISOString(),
      },
    ];

    await expect(
      testHooks.checkPaymentLimits(WALLET_A, USER_A, '300')
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'PAYMENT_DAILY_CAP_EXCEEDED',
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('rejects payment when daily transaction count reaches limit (20)', async () => {
    persistence.paymentRecords = Array.from({ length: 20 }, (_, i) => ({
      id: `rec-${i}`,
      auth_user_id: USER_A,
      wallet_address: WALLET_A,
      amount: '10',
      created_at: new Date(Date.now() - (20 - i) * 60 * 1000).toISOString(),
    }));

    await expect(
      testHooks.checkPaymentLimits(WALLET_A, USER_A, '10')
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'PAYMENT_DAILY_COUNT_EXCEEDED',
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('rejects payment when velocity limit is exceeded (> 10 per minute)', async () => {
    const now = Date.now();
    persistence.paymentRecords = Array.from({ length: 10 }, (_, i) => ({
      id: `velocity-${i}`,
      auth_user_id: USER_A,
      wallet_address: WALLET_A,
      amount: '5',
      created_at: new Date(now - (10 - i) * 1000).toISOString(),
    }));

    await expect(
      testHooks.checkPaymentLimits(WALLET_A, USER_A, '5')
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'PAYMENT_VELOCITY_EXCEEDED',
      retryAfterSeconds: expect.any(Number),
    });
  });

  it('fails closed when payment limits lookup errors out (503)', async () => {
    const failMod = await loadServerModule({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        walletOwners: { [WALLET_A]: USER_A },
        failPaymentRecordsLookup: true,
      }),
    });

    await expect(
      failMod.testHooks.checkPaymentLimits(WALLET_A, USER_A, '50')
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'PAYMENT_LIMITS_UNAVAILABLE',
      retryable: true,
    });

    const { status, body } = await getJson(
      failMod.app,
      '/payments/limits',
      { Authorization: makeBearerToken(USER_A) }
    );

    expect(status).toBe(503);
    expect(body.code).toBe('PAYMENT_LIMITS_UNAVAILABLE');
  });

  it('enforces limits even when client-side checks are completely bypassed (patched client)', async () => {
    // Fill up daily allowance to 4900
    persistence.paymentRecords = [
      {
        id: 'rec-bypass',
        auth_user_id: USER_A,
        wallet_address: WALLET_A,
        amount: '4900',
        created_at: new Date().toISOString(),
      },
    ];

    // Client check bypassed: attempts to check limit for 200
    await expect(
      testHooks.checkPaymentLimits(WALLET_A, USER_A, '200')
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'PAYMENT_DAILY_CAP_EXCEEDED',
    });
  });
});

describe('Multi-instance coordination and bounded memory state', () => {
  let sharedPersistence;
  let instance1;
  let instance2;

  beforeEach(async () => {
    sharedPersistence = {
      locks: new Map(),
      claims: [],
      paymentRecords: [],
    };

    instance1 = await loadServerModule({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        walletOwners: { [WALLET_A]: USER_A },
        database: sharedPersistence,
      }),
    });

    instance2 = await loadServerModule({
      __fetchMock: buildFetchMock({
        userWallets: { [USER_A]: [WALLET_A] },
        walletOwners: { [WALLET_A]: USER_A },
        database: sharedPersistence,
      }),
    });
  });

  afterEach(async () => {
    await closeActiveModuleServers();
  });

  it('two relayer instances serialize Add Money requests identically to one', async () => {
    const userLockKey = `add-money-user:${USER_A}`;

    // Instance 1 acquires lock for USER_A
    const res1 = await instance1.testHooks.acquireAddMoneyUserLock(userLockKey, 60000);
    expect(res1).toEqual({ acquired: true });

    // Instance 2 attempts to acquire lock for same user concurrently -> rejected
    const res2 = await instance2.testHooks.acquireAddMoneyUserLock(userLockKey, 60000);
    expect(res2).toEqual({ acquired: false });

    // Instance 1 releases lock
    await instance1.testHooks.releaseAddMoneyUserLock(userLockKey);

    // Instance 2 can now acquire lock
    const res3 = await instance2.testHooks.acquireAddMoneyUserLock(userLockKey, 60000);
    expect(res3).toEqual({ acquired: true });
  });

  it('an expired user lock held by another instance is reclaimed automatically', async () => {
    const userLockKey = `add-money-user:${USER_A}`;

    // Insert an expired lock directly into shared persistence
    sharedPersistence.locks.set(userLockKey, {
      key: userLockKey,
      response: null,
      expires_at: new Date(Date.now() - 5000).toISOString(),
    });

    // Instance 2 should detect expired lock and take it over
    const res = await instance2.testHooks.acquireAddMoneyUserLock(userLockKey, 60000);
    expect(res).toEqual({ acquired: true });
  });

  it('balance alerts fire once per window across instances and reset when balances recover', async () => {
    // Instance 1 checks alert: fires and acquires window
    const shouldAlert1 = await instance1.testHooks.shouldSendLowBalanceAlert();
    expect(shouldAlert1).toBe(true);

    // Instance 2 checks alert within same window: deduplicated across instances
    const shouldAlert2 = await instance2.testHooks.shouldSendLowBalanceAlert();
    expect(shouldAlert2).toBe(false);

    // Balances recover: reset alert
    await instance1.testHooks.resetLowBalanceAlert();

    // After reset, a new alert can fire across instances
    const shouldAlert3 = await instance2.testHooks.shouldSendLowBalanceAlert();
    expect(shouldAlert3).toBe(true);
  });

  it('preparedAccountTransactions cache enforces max capacity and FIFO/TTL eviction', () => {
    const { preparedAccountTransactions, prunePreparedAccountTransactions } = instance1.testHooks;

    // Simulate expired entry
    preparedAccountTransactions['expired-key'] = {
      key: 'expired-key',
      expiresAt: Date.now() - 1000,
    };
    prunePreparedAccountTransactions();
    expect(preparedAccountTransactions['expired-key']).toBeUndefined();

    // Test capacity bounding
    for (let i = 0; i < 10005; i++) {
      preparedAccountTransactions[`key-${i}`] = {
        key: `key-${i}`,
        expiresAt: Date.now() + 60000,
      };
    }
    prunePreparedAccountTransactions();
    expect(Object.keys(preparedAccountTransactions).length).toBeLessThanOrEqual(10000);
  });

  it('activeAddMoneyUserLocks in-memory fallback cache enforces max capacity and TTL eviction', () => {
    const { activeAddMoneyUserLocks, pruneActiveAddMoneyUserLocks } = instance1.testHooks;

    // Simulate expired fallback lock
    activeAddMoneyUserLocks['expired-user'] = Date.now() - 1000;
    pruneActiveAddMoneyUserLocks();
    expect(activeAddMoneyUserLocks['expired-user']).toBeUndefined();

    // Fill capacity
    for (let i = 0; i < 1005; i++) {
      activeAddMoneyUserLocks[`user-${i}`] = Date.now() + 60000;
    }
    pruneActiveAddMoneyUserLocks();
    expect(Object.keys(activeAddMoneyUserLocks).length).toBeLessThanOrEqual(1000);
  });

  describe('Issue #121: Typed PostgREST error handling and conflict detection', () => {
    it('throws SupabaseRequestError with code 23505 and status 409 without putting raw body in message', async () => {
      const postgrestConflict = {
        code: '23505',
        details: 'Key (key)=(test-key) already exists.',
        hint: null,
        message: 'duplicate key value violates unique constraint "relayer_idempotency_keys_pkey"',
      };
      const customFetch = jest.fn(async () => makeResponse(false, 409, postgrestConflict));
      const mod = await loadServerModule({ __fetchMock: customFetch });

      let thrown = null;
      try {
        await mod.testHooks.supabaseRestRequest('relayer_idempotency_keys', {
          method: 'POST',
          body: JSON.stringify({ key: 'test-key' }),
        });
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeDefined();
      expect(thrown.name).toBe('SupabaseRequestError');
      expect(thrown.status).toBe(409);
      expect(thrown.code).toBe('23505');
      expect(thrown.details).toBe('Key (key)=(test-key) already exists.');
      expect(thrown.hint).toBeNull();
      expect(thrown.message).toBe('Supabase request failed with status 409');
      expect(thrown.message).not.toContain(JSON.stringify(postgrestConflict));
    });

    it('Branch 1: acquireAddMoneyUserLock handles PostgREST 409 unique constraint conflict', async () => {
      const now = Date.now();
      const customFetch = jest.fn(async (url, options) => {
        const urlStr = String(url);
        const method = options?.method || 'GET';
        if (urlStr.includes('/rest/v1/relayer_idempotency_keys')) {
          if (method === 'POST') {
            return makeResponse(false, 409, {
              code: '23505',
              details: 'Key (key)=(add-money-user:user-conflict) already exists.',
              hint: null,
              message: 'duplicate key value violates unique constraint',
            });
          }
          if (method === 'GET') {
            // Unexpired lock
            return makeResponse(true, 200, [{ expires_at: new Date(now + 60000).toISOString() }]);
          }
        }
        return makeResponse(true, 200, []);
      });

      const mod = await loadServerModule({ __fetchMock: customFetch });
      const result = await mod.testHooks.acquireAddMoneyUserLock('add-money-user:user-conflict', 60000);
      expect(result).toEqual({ acquired: false });
    });

    it('Branch 2: acquireIdempotencyLock handles PostgREST 409 unique constraint conflict and returns cached response', async () => {
      const cachedResponse = { hash: 'tx-123', status: 'success' };
      const customFetch = jest.fn(async (url, options) => {
        const urlStr = String(url);
        const method = options?.method || 'GET';
        if (urlStr.includes('/rest/v1/relayer_idempotency_keys')) {
          if (method === 'POST') {
            return makeResponse(false, 409, {
              code: '23505',
              details: 'Key (key)=(req-key) already exists.',
              hint: null,
              message: 'duplicate key value violates unique constraint',
            });
          }
          if (method === 'GET') {
            return makeResponse(true, 200, [{ response: cachedResponse }]);
          }
        }
        return makeResponse(true, 200, []);
      });

      const mod = await loadServerModule({ __fetchMock: customFetch });
      const result = await mod.testHooks.acquireIdempotencyLock('req-key', 60000);
      expect(result).toEqual({ acquired: false, response: cachedResponse });
    });
  });
});

