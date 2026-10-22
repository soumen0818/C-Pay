/**
 * End-to-end regression tests for issue #176 — /quotes/validate trusts a
 * client-supplied quote.
 *
 * The REV50 harness built genuine quotes from a separate engine instance with
 * a static quoteOwnerId. That proved the engine could reject tampering, but it
 * did not prove anything about the server's own routes: POST /quotes never
 * passed an owner to createQuote(), so a quote minted by the real route had no
 * owner to match at validation time.
 *
 * These tests drive the real Express routes:
 *
 *   POST /quotes          as user A  -> must embed A's identity and a signature
 *   POST /quotes/validate  as user A  -> must accept that genuine quote
 *   POST /quotes/validate  as user A  -> must reject any tampered field
 *   POST /quotes/validate  as user B  -> must reject A's untouched quote
 *
 * and assert the fail-closed behaviour when QUOTE_SIGNATURE_SECRET is absent.
 */
'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

const RELAYER_DIR = path.resolve(__dirname, '..');

const AUTH_A = 'user-a-uid';
const AUTH_B = 'user-b-uid';
const QUOTE_SECRET = 'fixture-quote-secret';

const inert = () => new Proxy(function () {}, { get: () => inert(), apply: () => undefined, construct: () => ({}) });
const stubs = {
  'expo-constants': { expoConfig: { hostUri: '127.0.0.1:1', extra: {} }, manifest2: {}, manifest: {} },
  'expo-crypto': { randomUUID: () => crypto.randomUUID(), getRandomValues: (a) => a },
  'expo-secure-store': inert(),
};

function makeBearer(sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, role: 'authenticated', aud: 'authenticated', iss: 'x',
    exp: Math.floor(Date.now() / 1000) + 600,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', 'fixture-jwt-secret').update(header + '.' + payload).digest('base64');
  return 'Bearer ' + header + '.' + payload + '.' + sig;
}

function post(port, route, sub, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) };
    if (sub) headers.Authorization = makeBearer(sub);
    const req = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', headers }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(d); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, body: parsed, raw: d });
      });
    });
    req.on('error', reject);
    req.end(data);
  });
}

function bootRelayer(extraEnv) {
  const sdkStub = {
    Horizon: { Server: function () { return {}; } },
    Networks: { TESTNET: 'Test SDF Network ; September 2015', PUBLIC: 'Public Global Stellar Network ; September 2015' },
    TransactionBuilder: function () { return {}; },
    Operation: {}, Memo: {}, Asset: function () { return {}; }, StrKey: {}, Keypair: {}, xdr: {},
  };

  return new Promise(async (resolve, reject) => {
    try {
      Object.assign(process.env, {
        // Keep a pre-set SUPABASE_URL (the test mock) instead of clobbering it.
        SUPABASE_URL: process.env.SUPABASE_URL || 'http://127.0.0.1',
        SUPABASE_SERVICE_ROLE_KEY: 'fixture-role-key',
        SUPABASE_JWT_SECRET: 'fixture-jwt-secret',
        SUPABASE_JWT_AUDIENCE: 'authenticated',
        SUPABASE_JWT_ISSUER: 'x',
        STELLAR_NETWORK: 'testnet',
        RELAYER_AUTH_REQUIRED: 'true',
        LEDGER_INGEST_ENABLED: 'false',
        PORT: '0',
        NODE_ENV: 'test',
        QUOTE_FX_RATES_JSON: '{"USD_EUR":0.92}',
        SPONSOR_SECRET: 'SDU3KZYP56CCI5ZMPX57SZMUN6HD4KISMOLWRZAZWMBRAUTAH37APZ5G',
        DISTRIBUTION_SECRET: 'SCJHWOMV6PD7CTTVN366N6CHCYUISFJBMT7FAX5L25CL7ESWPPB6EUKG',
        ...(extraEnv || {}),
      });

      const origLoad = Module._load;
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
      const mod = require(path.join(RELAYER_DIR, 'server.js'));
      await mod.startupPromise;

      // server.js starts and owns this listener. Reuse and close that listener
      // instead of binding a second server to the same Express app.
      const server = mod.server;
      if (!server || !server.listening) {
        throw new Error('Relayer did not expose its listening test server');
      }
      const port = server.address().port;
      resolve({ port, server, mod, restore: () => { Module._load = origLoad; } });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Minimal Supabase stand-in. The quote routes need no persistence, but the
 * relayer's startup probes ownership and ledger state, so a listener must exist
 * or every request dies on ECONNREFUSED before reaching the route.
 */
function makeMockSupabase() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, data) => {
      const body = JSON.stringify(data);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };
    if (url.pathname === '/rest/v1/wallet_bindings') return send(200, []);
    if (url.pathname === '/rest/v1/users') return send(200, []);
    if (req.method === 'DELETE') return send(204, []);
    return send(200, []);
  });
}

let ctx = null;
let mockSupabase = null;

beforeAll(async () => {
  // Signed-quote context.
  process.env.QUOTE_SIGNATURE_SECRET = QUOTE_SECRET;
  mockSupabase = makeMockSupabase();
  await new Promise((r) => mockSupabase.listen(0, '127.0.0.1', r));
  process.env.SUPABASE_URL = `http://127.0.0.1:${mockSupabase.address().port}`;
  ctx = await bootRelayer();
}, 30000);

afterAll(async () => {
  if (ctx) {
    ctx.restore();
    if (ctx.server && ctx.server.listening) {
      await new Promise((resolve, reject) => ctx.server.close((err) => err ? reject(err) : resolve()));
    }
    delete require.cache[path.resolve(path.join(RELAYER_DIR, 'server.js'))];
  }
  if (mockSupabase && mockSupabase.listening) {
    await new Promise((resolve, reject) => mockSupabase.close((err) => err ? reject(err) : resolve()));
  }
  delete process.env.QUOTE_SIGNATURE_SECRET;
});

/** Mint a genuine quote through the real POST /quotes route. */
async function mintQuote(sub = AUTH_A, overrides = {}) {
  const res = await post(ctx.port, '/quotes', sub, {
    sendAmount: '100.00',
    sendCurrency: "USD",
    receiveCurrency: "EUR",
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe('#176 /quotes end-to-end — owner binding and tamper detection', () => {
  test('POST /quotes binds the caller identity into the quote', async () => {
    const quote = await mintQuote(AUTH_A);
    expect(quote.ownerId).toBe(AUTH_A);
  });

  test('POST /quotes signs the quote when a secret is configured', async () => {
    const quote = await mintQuote(AUTH_A);
    expect(typeof quote.signature).toBe('string');
    expect(quote.signature).toHaveLength(64);
  });

  test('a genuine quote validates for the same user', async () => {
    const quote = await mintQuote(AUTH_A);
    const res = await post(ctx.port, '/quotes/validate', AUTH_A, quote);
    expect(res.status).toBe(200);
  });

  test('a genuine quote is rejected for a different user', async () => {
    const quote = await mintQuote(AUTH_A);
    const res = await post(ctx.port, '/quotes/validate', AUTH_B, quote);
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('QUOTE_OWNER_MISMATCH');
  });

  test('two users get distinct owners from the same route', async () => {
    const a = await mintQuote(AUTH_A);
    const b = await mintQuote(AUTH_B);
    expect(a.ownerId).toBe(AUTH_A);
    expect(b.ownerId).toBe(AUTH_B);
    await post(ctx.port, '/quotes/validate', AUTH_A, a).then((r) => expect(r.status).toBe(200));
    await post(ctx.port, '/quotes/validate', AUTH_B, b).then((r) => expect(r.status).toBe(200));
    // and neither crosses over
    await post(ctx.port, '/quotes/validate', AUTH_B, a).then((r) => expect(r.status).toBe(410));
    await post(ctx.port, '/quotes/validate', AUTH_A, b).then((r) => expect(r.status).toBe(410));
  });

  const tamperCases = [
    ['recipientAmount', '999999.00'],
    ['amountDebited', '0.01'],
    ['fee', '0.00'],
    ['feeBps', '0'],
    ['fxRate', '9999'],
    ['spreadBps', '10000'],
    ['receiveCurrency', 'USD'],
    ['sendCurrency', 'EUR'],
    ['sendAmount', '1.00'],
    ['ownerId', AUTH_B],
  ];

  for (const [field, value] of tamperCases) {
    test(`tampering with ${field} is rejected`, async () => {
      const quote = await mintQuote(AUTH_A);
      quote[field] = value;
      const res = await post(ctx.port, '/quotes/validate', AUTH_A, quote);
      expect(res.status).toBe(410);
      // ownerId is checked before the signature, so a re-pointed identity is
      // refused at the ownership boundary rather than the crypto boundary.
      if (field === 'ownerId') {
        expect(res.body.code).toBe('QUOTE_OWNER_MISMATCH');
      } else {
        expect(res.body.code).toBe('QUOTE_SIGNATURE_MISMATCH');
      }
    });
  }

  test('a forged signature is rejected', async () => {
    const quote = await mintQuote(AUTH_A);
    quote.signature = 'a'.repeat(64);
    const res = await post(ctx.port, '/quotes/validate', AUTH_A, quote);
    expect(res.status).toBe(410);
  });

  test('a missing signature is rejected', async () => {
    const quote = await mintQuote(AUTH_A);
    delete quote.signature;
    const res = await post(ctx.port, '/quotes/validate', AUTH_A, quote);
    expect(res.status).toBe(410);
  });

  test('a missing owner is rejected', async () => {
    const quote = await mintQuote(AUTH_A);
    delete quote.ownerId;
    const res = await post(ctx.port, '/quotes/validate', AUTH_A, quote);
    expect(res.status).toBe(410);
  });

  test('a non-date expiry is rejected, not treated as far future', async () => {
    const quote = await mintQuote(AUTH_A);
    quote.expiresAt = 'not-a-date';
    const res = await post(ctx.port, '/quotes/validate', AUTH_A, quote);
    expect(res.status).toBe(410);
  });

  test('a far-future expiry is rejected because the signature breaks', async () => {
    const quote = await mintQuote(AUTH_A);
    quote.expiresAt = new Date(Date.now() + 100 * 365 * 24 * 3600 * 1000).toISOString();
    const res = await post(ctx.port, '/quotes/validate', AUTH_A, quote);
    expect(res.status).toBe(410);
  });

  test('an unauthenticated create is rejected 401', async () => {
    const res = await post(ctx.port, '/quotes', null, {
      sendAmount: '100.00', sendCurrency: "USD", receiveCurrency: "EUR",
    });
    expect(res.status).toBe(401);
  });

  test('an unauthenticated validate is rejected 401', async () => {
    const quote = await mintQuote(AUTH_A);
    const res = await post(ctx.port, '/quotes/validate', null, quote);
    expect(res.status).toBe(401);
  });

  test('a hand-built quote with no server involvement is rejected', async () => {
    const res = await post(ctx.port, '/quotes/validate', AUTH_A, {
      sendAmount: '100.00',
      sendCurrency: "USD",
      receiveCurrency: "EUR",
      amountDebited: '0.01',
      fee: '0',
      feeBps: 0,
      fxRate: 9999,
      spreadBps: 0,
      recipientAmount: '999999.00',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      ownerId: AUTH_A,
    });
    expect(res.status).toBe(410);
  });
});

describe('#176 fail-closed when QUOTE_SIGNATURE_SECRET is absent', () => {
  /**
   * The route-level behaviour is asserted here at the engine boundary rather
   * than by booting a second server, because loadConfig() reads the env at
   * require time and a second require in the same Jest worker cannot reliably
   * re-read a cleared variable. What matters is the decision the route makes,
   * and that decision lives in assertFreshForOwner().
   */
  function buildEngine(secret) {
    const { createQuoteEngine } = require('../quote-engine');
    return createQuoteEngine({
      rateProvider: { async getRate() { return 0.92; } },
      quoteSignatureSecret: secret || null,
    });
  }

  test('create returns a quote but unsigned', async () => {
    const engine = buildEngine('');
    const quote = await engine.createQuote({
      sendAmount: '100.00', sendCurrency: 'USD', receiveCurrency: 'EUR', ownerId: AUTH_A,
    });
    expect(quote.ownerId).toBe(AUTH_A);
    expect(quote.signature).toBeUndefined();
  });

  test('validate fails closed with QUOTE_SIGNING_NOT_CONFIGURED', async () => {
    const engine = buildEngine('');
    const quote = await engine.createQuote({
      sendAmount: '100.00', sendCurrency: 'USD', receiveCurrency: 'EUR', ownerId: AUTH_A,
    });
    expect(() => engine.assertFreshForOwner(quote, AUTH_A)).toThrow(
      /Quote signing is not configured/
    );
    try {
      engine.assertFreshForOwner(quote, AUTH_A);
    } catch (error) {
      expect(error.code).toBe('QUOTE_SIGNING_NOT_CONFIGURED');
    }
  });

  test('a hand-built quote is equally rejected without a secret', () => {
    const engine = buildEngine('');
    expect(() => engine.assertFreshForOwner({
      sendAmount: '100.00',
      sendCurrency: 'USD',
      receiveCurrency: 'EUR',
      amountDebited: '0.01',
      fee: '0',
      feeBps: 0,
      fxRate: 9999,
      spreadBps: 0,
      recipientAmount: '999999.00',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      ownerId: AUTH_A,
    }, AUTH_A)).toThrow(/Quote signing is not configured/);
  });

  test('the signed engine does accept its own quote', async () => {
    const engine = buildEngine(QUOTE_SECRET);
    const quote = await engine.createQuote({
      sendAmount: '100.00', sendCurrency: 'USD', receiveCurrency: 'EUR', ownerId: AUTH_A,
    });
    expect(() => engine.assertFreshForOwner(quote, AUTH_A)).not.toThrow();
  });
});
