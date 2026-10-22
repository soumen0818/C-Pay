/**
 * Regression tests for issue #159 — /payments/limits must not let a
 * caller-supplied accountId widen the aggregation to another user's rows.
 *
 * The route previously passed req.query.accountId straight into
 * getPaymentRecords(), which built an OR filter:
 *
 *   or=(auth_user_id.eq.<me>,wallet_address.eq.<caller supplied>)
 *
 * That OR summed both identities' totals, and the raw client string was also
 * reachable as a PostgREST filter payload.
 *
 * These tests run against the real Express app with a mocked Supabase so the
 * route, its middleware chain, and getPaymentRecords() are all exercised.
 */
'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const RELAYER_DIR = path.resolve(__dirname, '..');

const WALLET_A = 'GC4KGQS25OP6JNUZXIZHS2TOLQHS2K34HJKX4H3M2IBIFRO4SL7SW7RV';
const WALLET_B = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const WALLET_C = 'GDZFWHKXR66BWJ7KBX3FUEPELJB37YTVC4VMHIK6Q5FTIXU4UCGM2R5H';
const AUTH_A = 'user-a-uid';
const AUTH_B = 'user-b-uid';

const inert = () => new Proxy(function () {}, { get: () => inert(), apply: () => undefined, construct: () => ({}) });
const stubs = {
  'expo-constants': { expoConfig: { hostUri: '127.0.0.1:1', extra: {} }, manifest2: {}, manifest: {} },
  'expo-crypto': { randomUUID: () => crypto.randomUUID(), getRandomValues: (a) => a },
  'expo-secure-store': inert(),
};

let paymentQueries = [];
let paymentRows = [];

function resetStore() {
  paymentQueries = [];
  paymentRows = [
    { id: 'r1', auth_user_id: AUTH_A, wallet_address: WALLET_A, amount: 30, status: 'success', created_at: new Date().toISOString() },
    { id: 'r2', auth_user_id: AUTH_A, wallet_address: WALLET_A, amount: 0, status: 'success', created_at: new Date().toISOString() },
    { id: 'r3', auth_user_id: AUTH_B, wallet_address: WALLET_B, amount: 120, status: 'success', created_at: new Date().toISOString() },
    { id: 'r4', auth_user_id: AUTH_B, wallet_address: WALLET_B, amount: 0, status: 'success', created_at: new Date().toISOString() },
    { id: 'r5', auth_user_id: AUTH_B, wallet_address: WALLET_B, amount: 5, status: 'success', created_at: new Date().toISOString() },
  ];
}

/**
 * Minimal PostgREST-shaped mock. Records every query it receives and honours
 * the two filter shapes the relayer can build, so a widened OR is visible as a
 * different row set rather than being silently ignored.
 */
function makeMockSupabase() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, data) => {
      const body = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };

    if (url.pathname === '/rest/v1/wallet_bindings') {
      const au = url.searchParams.get('auth_user_id');
      if (au) {
        const uid = String(au).replace(/^eq\./, '');
        const owned = [];
        if (uid === AUTH_A) owned.push({ wallet_address: WALLET_A });
        if (uid === AUTH_B) owned.push({ wallet_address: WALLET_B });
        return send(200, owned);
      }
      const wa = url.searchParams.get('wallet_address');
      if (wa) {
        const w = String(wa).replace(/^eq\./, '');
        return send(200, w === WALLET_A ? [{ auth_user_id: AUTH_A }] : []);
      }
      return send(200, []);
    }

    if (url.pathname === '/rest/v1/payment_records') {
      paymentQueries.push({
        method: req.method,
        or: url.searchParams.get('or'),
        authUserId: url.searchParams.get('auth_user_id'),
        walletAddress: url.searchParams.get('wallet_address'),
        select: url.searchParams.get('select'),
      });
      if (req.method !== 'GET') return send(200, []);

      const orFilter = url.searchParams.get('or');
      const authFilter = url.searchParams.get('auth_user_id');
      const walletFilter = url.searchParams.get('wallet_address');
      let rows = paymentRows;
      if (orFilter) {
        // Two shapes reach here:
        //   vulnerable:  or=(auth_user_id.eq.X,wallet_address.eq.Y)
        //   fixed legacy: or=(auth_user_id.eq.X,and(auth_user_id.is.null,wallet_address.eq.Y))
        // The fixed shape is only ever built from a server-resolved binding, so
        // the mock parses it precisely instead of loosely matching a wallet
        // anywhere in the string.
        const legacyMatch = /^auth_user_id\.eq\.([^,]+),and\(auth_user_id\.is\.null,wallet_address\.eq\.([^)]+)\)$/.exec(orFilter);
        if (legacyMatch) {
          const uid = legacyMatch[1];
          const wallet = legacyMatch[2];
          rows = rows.filter((r) =>
            r.auth_user_id === uid ||
            (r.auth_user_id === null && r.wallet_address === wallet));
        } else {
          const authMatch = /auth_user_id\.eq\.([^,)]+)/.exec(orFilter);
          const walletMatch = /wallet_address\.eq\.([^,)]+)/.exec(orFilter);
          rows = rows.filter((r) =>
            (authMatch && r.auth_user_id === authMatch[1]) ||
            (walletMatch && r.wallet_address === walletMatch[1]));
        }
      } else {
        if (authFilter === 'is.null') {
          // Legacy sweep: rows with no identity at all, further narrowed by the
          // server-resolved wallet binding.
          rows = rows.filter((r) => r.auth_user_id === null);
        } else if (authFilter) {
          const v = String(authFilter).replace(/^eq\./, '');
          rows = rows.filter((r) => r.auth_user_id === v);
        }
        if (walletFilter) {
          const v = String(walletFilter).replace(/^eq\./, '');
          rows = rows.filter((r) => r.wallet_address === v);
        }
      }
      return send(200, rows);
    }

    if (req.method === 'DELETE') return send(204, []);
    return send(200, []);
  });
}

function makeBearer(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, role: 'authenticated', aud: 'authenticated', iss: 'x',
    exp: Math.floor(Date.now() / 1000) + 600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', 'fixture-jwt-secret').update(header + '.' + payload).digest('base64');
  return 'Bearer ' + header + '.' + payload + '.' + sig;
}

function getLimits(port, sub, accountId) {
  const q = accountId === undefined ? '' : `?accountId=${encodeURIComponent(accountId)}`;
  return new Promise((resolve, reject) => {
    http.get({
      host: '127.0.0.1', port, path: '/payments/limits' + q,
      headers: { Authorization: makeBearer(sub) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(d); } catch (e) { body = null; }
        resolve({ status: res.statusCode, body, raw: d });
      });
    }).on('error', reject);
  });
}

let sharedServer = null;
let sharedPort = 0;
let relayerModule = null;
let origLoad = null;
let mockSupabase = null;
let mockSupabasePort = 0;

async function bootRelayer() {
  mockSupabase = makeMockSupabase();
  await new Promise((r) => mockSupabase.listen(0, '127.0.0.1', r));
  mockSupabasePort = mockSupabase.address().port;

  Object.assign(process.env, {
    SUPABASE_URL: `http://127.0.0.1:${mockSupabasePort}`,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-role-key',
    SUPABASE_JWT_SECRET: 'fixture-jwt-secret',
    STELLAR_NETWORK: 'testnet',
    RELAYER_AUTH_REQUIRED: 'true',
    LEDGER_INGEST_ENABLED: 'false',
    PORT: '0',
    NODE_ENV: 'test',
    SPONSOR_SECRET: 'SDU3KZYP56CCI5ZMPX57SZMUN6HD4KISMOLWRZAZWMBRAUTAH37APZ5G',
    DISTRIBUTION_SECRET: 'SCJHWOMV6PD7CTTVN366N6CHCYUISFJBMT7FAX5L25CL7ESWPPB6EUKG',
  });

  const sdkStub = {
    Horizon: { Server: function () { return {}; } },
    Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
    TransactionBuilder: function () { return {}; },
    Operation: {}, Memo: {}, Asset: function () { return {}; }, StrKey: {}, Keypair: {}, xdr: {},
  };
  origLoad = Module._load;
  Module._load = function (request) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      const v = stubs[request];
      return { ...v, default: v, __esModule: true };
    }
    if (request === '@stellar/stellar-sdk' || request === '@stellar/stellar-base') {
      return { ...sdkStub, default: sdkStub, __esModule: true };
    }
    return origLoad.apply(this, arguments);
  };

  delete require.cache[path.resolve(path.join(RELAYER_DIR, 'server.js'))];
  // server.js starts its own HTTP listener during module evaluation. Reuse it;
  // creating a second listener leaks the first one and causes Jest to hang.
  relayerModule = require(path.join(RELAYER_DIR, 'server.js'));
  await relayerModule.startupPromise;
  sharedServer = relayerModule.server;
  if (!sharedServer || !sharedServer.listening) {
    throw new Error('Relayer did not expose its listening test server');
  }
  sharedPort = sharedServer.address().port;
}

beforeAll(async () => {
  await bootRelayer();
}, 30000);

afterAll(async () => {
  if (origLoad) Module._load = origLoad;
  if (sharedServer && sharedServer.listening) {
    await new Promise((resolve, reject) => sharedServer.close((err) => err ? reject(err) : resolve()));
  }
  if (mockSupabase && mockSupabase.listening) {
    await new Promise((resolve, reject) => mockSupabase.close((err) => err ? reject(err) : resolve()));
  }
  delete require.cache[path.resolve(path.join(RELAYER_DIR, 'server.js'))];
});

beforeEach(() => {
  resetStore();
});

/**
 * Legacy-row compatibility.
 *
 * The patch aggregates by auth_user_id only. Payment rows written before
 * auth_user_id was populated have auth_user_id IS NULL but a wallet_address
 * bound to the user. Those payments are real spend and must still count toward
 * the quota, otherwise a migrated account silently gets extra allowance.
 *
 * Server stays authoritative: the caller cannot widen the scope by supplying an
 * accountId, and a wallet bound to another user is still refused.
 */
describe('#159 /payments/limits — legacy rows with auth_user_id IS NULL', () => {
  // Reset to the base fixture so each test starts from amountToday = 30.
  beforeEach(() => { resetStore(); });

  test('a legacy row on the caller\'s own wallet still counts toward the quota', async () => {
    // A pre-migration payment: no auth_user_id, but the wallet is bound to A.
    paymentRows.push({
      id: 'legacy-1',
      auth_user_id: null,
      wallet_address: WALLET_A,
      amount: 5,
      status: 'success',
      created_at: new Date().toISOString(),
    });
    const res = await getLimits(sharedPort, AUTH_A, undefined);
    expect(res.status).toBe(200);
    // 30 (auth-scoped) + 5 (wallet-scoped legacy) — history is not discarded.
    expect(res.body.amountToday).toBe(35);
    expect(res.body.transactionsToday).toBe(3);
  });

  test('a legacy row on a wallet the caller does not own does not inflate the quota', async () => {
    paymentRows.push({
      id: 'legacy-2',
      auth_user_id: null,
      wallet_address: WALLET_B,
      amount: 5,
      status: 'success',
      created_at: new Date().toISOString(),
    });
    const res = await getLimits(sharedPort, AUTH_A, undefined);
    expect(res.status).toBe(200);
    expect(res.body.amountToday).toBe(30);
    expect(res.body.transactionsToday).toBe(2);
  });

  test('legacy rows do not re-open the cross-user read', async () => {
    paymentRows.push({
      id: 'legacy-3',
      auth_user_id: null,
      wallet_address: WALLET_B,
      amount: 5,
      status: 'success',
      created_at: new Date().toISOString(),
    });
    const res = await getLimits(sharedPort, AUTH_A, WALLET_B);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WALLET_OWNERSHIP_DENIED');
  });
});

describe('#159 /payments/limits — PostgREST filter injection and cross-user read', () => {
  test('own wallet returns 200 with that user\'s own totals', async () => {
    const res = await getLimits(sharedPort, AUTH_A, WALLET_A);
    expect(res.status).toBe(200);
    expect(res.body.amountToday).toBe(30);
    expect(res.body.transactionsToday).toBe(2);
  });

  test('empty accountId returns 200 scoped to the authenticated user', async () => {
    const res = await getLimits(sharedPort, AUTH_A, '');
    expect(res.status).toBe(200);
    expect(res.body.amountToday).toBe(30);
    expect(res.body.transactionsToday).toBe(2);
  });

  test('absent accountId returns 200 scoped to the authenticated user', async () => {
    const res = await getLimits(sharedPort, AUTH_A, undefined);
    expect(res.status).toBe(200);
    expect(res.body.amountToday).toBe(30);
  });

  test('a wallet the caller does not own is rejected 403', async () => {
    const res = await getLimits(sharedPort, AUTH_A, WALLET_B);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WALLET_OWNERSHIP_DENIED');
  });

  test('a wallet belonging to nobody is rejected 403, not 200', async () => {
    const res = await getLimits(sharedPort, AUTH_A, WALLET_C);
    expect(res.status).toBe(403);
  });

  test('a PostgREST filter payload in accountId is rejected 400 before any query', async () => {
    const res = await getLimits(sharedPort, AUTH_A, 'x,or=(auth_user_id.eq.user-a-uid)');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_ACCOUNT_ID');
    expect(paymentQueries.filter((q) => q.method === 'GET')).toHaveLength(0);
  });

  test('a bare OR payload in accountId is rejected 400 before any query', async () => {
    const res = await getLimits(sharedPort, AUTH_A, 'or=(auth_user_id.eq.user-a-uid)');
    expect(res.status).toBe(400);
    expect(paymentQueries.filter((q) => q.method === 'GET')).toHaveLength(0);
  });

  test('a non-Stellar string is rejected 400', async () => {
    const res = await getLimits(sharedPort, AUTH_A, 'not-a-key');
    expect(res.status).toBe(400);
  });

  test('repeated accountId params cannot smuggle a second filter', async () => {
    const res = await getLimits(sharedPort, AUTH_A, [WALLET_A, WALLET_B]);
    expect([400, 403]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });

  test('no query is ever built by concatenating an or=(...) string', async () => {
    await getLimits(sharedPort, AUTH_A, WALLET_A);
    await getLimits(sharedPort, AUTH_A, '');
    const gets = paymentQueries.filter((q) => q.method === 'GET');
    expect(gets.length).toBeGreaterThan(0);
    for (const q of gets) {
      // The vulnerable shape concatenated a caller-supplied wallet into an
      // or=(...) filter. That string must never appear again.
      expect(q.or).toBeNull();
    }
  });

  test('every query is scoped to the caller identity or to a NULL-identity legacy sweep', async () => {
    await getLimits(sharedPort, AUTH_A, WALLET_A);
    const gets = paymentQueries.filter((q) => q.method === 'GET');
    expect(gets.length).toBeGreaterThan(0);
    for (const q of gets) {
      // Either the caller's own identity, or the legacy gate that only matches
      // rows with no identity at all. A bare wallet scope is never sufficient.
      expect(['eq.user-a-uid', 'is.null']).toContain(q.authUserId);
    }
  });

  test('a second user sees only their own totals, never a merged sum', async () => {
    const res = await getLimits(sharedPort, AUTH_B, WALLET_B);
    expect(res.status).toBe(200);
    expect(res.body.amountToday).toBe(125);
    expect(res.body.transactionsToday).toBe(3);
  });

  test('an unauthenticated request is rejected 401', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: sharedPort, path: '/payments/limits' }, (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => resolve({ status: r.statusCode }));
      }).on('error', reject);
    });
    expect(res.status).toBe(401);
  });
});
