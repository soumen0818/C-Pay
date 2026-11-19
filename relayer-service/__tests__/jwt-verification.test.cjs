'use strict';

/**
 * Issue #175 Test Suite
 *
 * Covers:
 * 1. Missing exp, expired exp, and invalid exp are rejected.
 * 2. Wrong aud or missing aud are rejected; string and array aud are accepted.
 * 3. Wrong iss or missing iss are rejected; derived and overridden iss are accepted.
 * 4. Missing sub, alg: none, and wrong role are rejected.
 * 5. Asymmetric ES256 tokens are verified via JWKS with key caching.
 * 6. Asymmetric RS256 tokens are verified via JWKS.
 * 7. Verified tokens are cached for short TTL by token hash to prevent redundant work.
 * 8. Fallback to Auth API is only allowed when explicitly configured.
 * 9. Startup fails closed if relayer authentication is enabled without a derivable issuer.
 */

const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (['@stellar/stellar-sdk', 'express', 'helmet', 'cors', 'express-rate-limit', 'dotenv'].includes(request)) {
    try {
      return origLoad.apply(this, arguments);
    } catch (_) {
      if (request === '@stellar/stellar-sdk') {
        return {
          Networks: { TESTNET: 'testnet', PUBLIC: 'public' },
          BASE_FEE: 100,
          StrKey: { isValidEd25519PublicKey: () => true },
          Horizon: { Server: function () {} },
          Asset: function () {},
          Keypair: {
            fromSecret: () => ({
              publicKey: () => 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            }),
          },
        };
      }
      if (request === 'express') {
        const app = function () {};
        app.use = function () {};
        app.get = function () {};
        app.post = function () {};
        app.listen = function (port, host, cb) {
          const l = {
            ref: () => {},
            close: (c) => c && c(),
            listening: true,
            address: () => ({ port: 3000 }),
            once: (evt, fn) => {
              if (evt === 'listening') setTimeout(fn, 1);
            },
          };
          if (cb) setTimeout(cb, 1);
          return l;
        };
        const expressFn = () => app;
        expressFn.json = () => (req, res, next) => next && next();
        return expressFn;
      }
      if (request === 'helmet' || request === 'cors' || request === 'express-rate-limit') {
        return () => (req, res, next) => next && next();
      }
      if (request === 'dotenv') {
        return { config: () => {} };
      }
    }
  }
  return origLoad.apply(this, arguments);
};

const crypto = require('crypto');
const http = require('http');
const path = require('path');

const JWT_SECRET = 'fixture-test-supabase-jwt-secret-key-12345';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mintHs256Token(claims, { secret = JWT_SECRET } = {}) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(sig)}`;
}

function mintEs256Token(claims, privateKey, { kid = 'es256-key-1' } = {}) {
  const header = b64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const payload = b64url(JSON.stringify(claims));
  const signedData = Buffer.from(`${header}.${payload}`);
  const sig = crypto.sign('SHA256', signedData, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${payload}.${b64url(sig)}`;
}

function mintRs256Token(claims, privateKey, { kid = 'rs256-key-1' } = {}) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const payload = b64url(JSON.stringify(claims));
  const signedData = Buffer.from(`${header}.${payload}`);
  const sig = crypto.sign('SHA256', signedData, privateKey);
  return `${header}.${payload}.${b64url(sig)}`;
}

async function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function loadRelayer() {
  const modulePath = path.resolve(__dirname, '..', 'server.js');
  delete require.cache[require.resolve(modulePath)];
  delete require.cache[require.resolve(path.resolve(__dirname, '..', 'config.js'))];
  return require(modulePath);
}

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['not ok', `${name} -> ${e && e.message ? e.message : e}`]);
  }
}

async function main() {
  // Generate EC and RSA keys for JWKS testing
  const ecKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecJwk = ecKey.publicKey.export({ format: 'jwk' });
  ecJwk.kid = 'es256-key-1';
  ecJwk.alg = 'ES256';
  ecJwk.use = 'sig';

  const rsaKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaJwk = rsaKey.publicKey.export({ format: 'jwk' });
  rsaJwk.kid = 'rs256-key-1';
  rsaJwk.alg = 'RS256';
  rsaJwk.use = 'sig';

  let jwksRequestsCount = 0;
  let authApiRequestsCount = 0;

  // Stub HTTP server simulating Supabase Auth API & JWKS
  const stubSupabase = http.createServer((req, res) => {
    if (req.url.includes('/auth/v1/.well-known/jwks.json')) {
      jwksRequestsCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [ecJwk, rsaJwk] }));
      return;
    }
    if (req.url.includes('/auth/v1/user')) {
      authApiRequestsCount++;
      const auth = req.headers['authorization'] || '';
      if (auth.includes('invalid-fallback')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Invalid token' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'fallback-user-id', aud: 'authenticated', role: 'authenticated', email: 'test@example.com' }));
      return;
    }
    if (req.url.includes('/rest/v1/wallet_bindings')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ id: '1' }]));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  const supaPort = await new Promise((resolve, reject) => {
    stubSupabase.once('error', reject);
    stubSupabase.listen(0, '127.0.0.1', () => resolve(stubSupabase.address().port));
  });

  const baseEnv = {
    SUPABASE_URL: `http://127.0.0.1:${supaPort}`,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key',
    SUPABASE_JWT_SECRET: JWT_SECRET,
    RELAYER_AUTH_REQUIRED: 'true',
    SPONSOR_SECRET: 'SCTIPFZ5KVBOENXTZK3FQPIGR5H73R5HE2MNZ4AXA7CA7JEEXUG5AF5G',
    DISTRIBUTION_SECRET: 'SBMJSD66AECV4CKZWTHXCH4EDZ5CRAZNNZL4OQP6IQAR4YLQ6HE5QJDM',
    USDC_ASSET_ISSUER: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    ALLOW_HTTP_HORIZON: 'true',
    ALLOW_CUSTOM_HORIZON: 'true',
    NODE_ENV: 'test',
    LEDGER_INGEST_ENABLED: 'false',
    CORS_ORIGIN: 'http://localhost:8081',
  };

  await withEnv(baseEnv, async () => {
    const relayer = loadRelayer();
    const verify = relayer.testHooks.verifySupabaseJwt;
    const defaultIss = `http://127.0.0.1:${supaPort}/auth/v1`;
    const future = Math.floor(Date.now() / 1000) + 3600;
    const past = Math.floor(Date.now() / 1000) - 60;

    // 1. Missing exp claim is rejected
    await test('missing exp claim is rejected', async () => {
      const token = mintHs256Token({ sub: 'user-1', aud: 'authenticated', iss: defaultIss, role: 'authenticated' });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('missing an expiry')) {
        throw new Error(`Expected missing expiry error, got: ${err && err.message}`);
      }
    });

    // 2. Expired exp claim is rejected
    await test('expired exp claim is rejected', async () => {
      const token = mintHs256Token({ sub: 'user-1', aud: 'authenticated', iss: defaultIss, role: 'authenticated', exp: past });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('Expired authentication token')) {
        throw new Error(`Expected expired error, got: ${err && err.message}`);
      }
    });

    // 3. Non-numeric exp claim is rejected
    await test('non-numeric exp claim is rejected', async () => {
      const token = mintHs256Token({ sub: 'user-1', aud: 'authenticated', iss: defaultIss, role: 'authenticated', exp: 'tomorrow' });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('missing an expiry')) {
        throw new Error(`Expected missing expiry error, got: ${err && err.message}`);
      }
    });

    // 4. Missing sub claim is rejected
    await test('missing sub claim is rejected', async () => {
      const token = mintHs256Token({ aud: 'authenticated', iss: defaultIss, role: 'authenticated', exp: future });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('Invalid authentication token')) {
        throw new Error(`Expected invalid token error, got: ${err && err.message}`);
      }
    });

    // 5. Wrong role is rejected
    await test('non-authenticated role is rejected', async () => {
      const token = mintHs256Token({ sub: 'user-1', role: 'anon', aud: 'authenticated', iss: defaultIss, exp: future });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('Authenticated user token required')) {
        throw new Error(`Expected role error, got: ${err && err.message}`);
      }
    });

    // 6. alg: none is rejected
    await test('alg: none is rejected', async () => {
      const h = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
      const p = b64url(JSON.stringify({ sub: 'user-1', role: 'authenticated', aud: 'authenticated', iss: defaultIss, exp: future }));
      let err;
      try {
        await verify(`Bearer ${h}.${p}.`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('Invalid authentication token')) {
        throw new Error(`Expected invalid token error, got: ${err && err.message}`);
      }
    });

    // 7. Wrong secret for HS256 is rejected
    await test('wrong HMAC secret is rejected', async () => {
      const token = mintHs256Token(
        { sub: 'user-1', role: 'authenticated', aud: 'authenticated', iss: defaultIss, exp: future },
        { secret: 'wrong-secret' }
      );
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('Invalid authentication token')) {
        throw new Error(`Expected invalid token error, got: ${err && err.message}`);
      }
    });

    // 8. Wrong aud is rejected
    await test('wrong aud is rejected under default enforcement', async () => {
      const token = mintHs256Token({ sub: 'user-1', role: 'authenticated', aud: 'other-aud', iss: defaultIss, exp: future });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('audience mismatch')) {
        throw new Error(`Expected audience mismatch error, got: ${err && err.message}`);
      }
    });

    // 9. Missing aud is rejected
    await test('missing aud is rejected under default enforcement', async () => {
      const token = mintHs256Token({ sub: 'user-1', role: 'authenticated', iss: defaultIss, exp: future });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('audience mismatch')) {
        throw new Error(`Expected audience mismatch error, got: ${err && err.message}`);
      }
    });

    // 10. Correct string aud is accepted
    await test('valid string aud is accepted', async () => {
      const token = mintHs256Token({ sub: 'user-1', role: 'authenticated', aud: 'authenticated', iss: defaultIss, exp: future });
      const claims = await verify(`Bearer ${token}`);
      if (!claims || claims.sub !== 'user-1') throw new Error('Valid token was not accepted');
    });

    // 11. Correct array aud is accepted
    await test('valid array aud containing expected value is accepted', async () => {
      const token = mintHs256Token({ sub: 'user-1', role: 'authenticated', aud: ['other-app', 'authenticated'], iss: defaultIss, exp: future });
      const claims = await verify(`Bearer ${token}`);
      if (!claims || claims.sub !== 'user-1') throw new Error('Valid array aud token was not accepted');
    });

    // 12. Array aud missing expected value is rejected
    await test('array aud missing expected value is rejected', async () => {
      const token = mintHs256Token({ sub: 'user-1', role: 'authenticated', aud: ['service_a', 'service_b'], iss: defaultIss, exp: future });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('audience mismatch')) {
        throw new Error(`Expected audience mismatch error, got: ${err && err.message}`);
      }
    });

    // 13. Wrong iss is rejected
    await test('wrong iss is rejected under default enforcement', async () => {
      const token = mintHs256Token({ sub: 'user-1', role: 'authenticated', aud: 'authenticated', iss: 'https://evil.example.com', exp: future });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('issuer mismatch')) {
        throw new Error(`Expected issuer mismatch error, got: ${err && err.message}`);
      }
    });

    // 14. Missing iss is rejected
    await test('missing iss is rejected under default enforcement', async () => {
      const token = mintHs256Token({ sub: 'user-1', role: 'authenticated', aud: 'authenticated', exp: future });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('issuer mismatch')) {
        throw new Error(`Expected issuer mismatch error, got: ${err && err.message}`);
      }
    });

    // 15. Valid ES256 token is accepted via JWKS
    await test('valid ES256 token is accepted via JWKS', async () => {
      jwksRequestsCount = 0;
      const token = mintEs256Token({
        sub: 'es256-user-123',
        role: 'authenticated',
        aud: 'authenticated',
        iss: defaultIss,
        exp: future,
      }, ecKey.privateKey, { kid: 'es256-key-1' });

      const claims = await verify(`Bearer ${token}`);
      if (!claims || claims.sub !== 'es256-user-123') throw new Error('Valid ES256 token was rejected');
      if (jwksRequestsCount !== 1) throw new Error(`Expected 1 JWKS request, got ${jwksRequestsCount}`);
    });

    // 16. ES256 token with invalid signature is rejected
    await test('ES256 token with forged/tampered signature is rejected', async () => {
      const token = mintEs256Token({
        sub: 'es256-user-123',
        role: 'authenticated',
        aud: 'authenticated',
        iss: defaultIss,
        exp: future,
      }, ecKey.privateKey, { kid: 'es256-key-1' });

      const [h, p] = token.split('.');
      const forgedToken = `${h}.${p}.${b64url(Buffer.from('forged-signature-bytes-64-bytes-00000000000000000000000000000000'))}`;
      let err;
      try {
        await verify(`Bearer ${forgedToken}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('Invalid authentication token')) {
        throw new Error(`Expected invalid token error, got: ${err && err.message}`);
      }
    });

    // 17. Valid RS256 token is accepted via JWKS
    await test('valid RS256 token is accepted via JWKS', async () => {
      const token = mintRs256Token({
        sub: 'rs256-user-456',
        role: 'authenticated',
        aud: 'authenticated',
        iss: defaultIss,
        exp: future,
      }, rsaKey.privateKey, { kid: 'rs256-key-1' });

      const claims = await verify(`Bearer ${token}`);
      if (!claims || claims.sub !== 'rs256-user-456') throw new Error('Valid RS256 token was rejected');
    });

    // 18. Short-TTL caching: repeated verification does not refetch JWKS or re-execute crypto
    await test('short-TTL caching returns cached claims without refetching JWKS', async () => {
      const initialJwksCount = jwksRequestsCount;
      const token = mintEs256Token({
        sub: 'cached-user-789',
        role: 'authenticated',
        aud: 'authenticated',
        iss: defaultIss,
        exp: future,
      }, ecKey.privateKey, { kid: 'es256-key-1' });

      const claims1 = await verify(`Bearer ${token}`);
      const countAfterFirst = jwksRequestsCount;
      const claims2 = await verify(`Bearer ${token}`);
      const countAfterSecond = jwksRequestsCount;

      if (claims1.sub !== 'cached-user-789' || claims2.sub !== 'cached-user-789') {
        throw new Error('Cached verification returned unexpected claims');
      }
      if (countAfterSecond !== countAfterFirst) {
        throw new Error('JWKS was re-fetched on cached token verification');
      }
    });

    // 19. Auth API fallback is rejected when not configured (default fail-closed)
    await test('unknown algorithm fails closed when Auth API fallback is not enabled', async () => {
      authApiRequestsCount = 0;
      const unknownHeader = b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
      const p = b64url(JSON.stringify({ sub: 'user-eddsa', role: 'authenticated', aud: 'authenticated', iss: defaultIss, exp: future }));
      const sig = b64url(Buffer.from('sig'));
      let err;
      try {
        await verify(`Bearer ${unknownHeader}.${p}.${sig}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('Invalid authentication token')) {
        throw new Error(`Expected invalid token error, got: ${err && err.message}`);
      }
      if (authApiRequestsCount !== 0) {
        throw new Error(`Auth API was invoked when fallback was disabled (count: ${authApiRequestsCount})`);
      }
    });

    if (relayer.server && relayer.server.listening) {
      await new Promise((resolve) => relayer.server.close(resolve));
    }
  });

  // 20. Configured overrides for audience and issuer
  await withEnv({
    ...baseEnv,
    SUPABASE_JWT_AUDIENCE: 'custom-client,custom-worker',
    SUPABASE_JWT_ISSUER: 'https://auth.custom-domain.org',
  }, async () => {
    const relayer = loadRelayer();
    const verify = relayer.testHooks.verifySupabaseJwt;
    const future = Math.floor(Date.now() / 1000) + 3600;

    await test('accepts configured custom audience and issuer overrides', async () => {
      const token = mintHs256Token({
        sub: 'custom-user',
        role: 'authenticated',
        aud: 'custom-client',
        iss: 'https://auth.custom-domain.org',
        exp: future,
      });
      const claims = await verify(`Bearer ${token}`);
      if (!claims || claims.sub !== 'custom-user') throw new Error('Token with configured overrides was rejected');
    });

    await test('rejects default audience when custom audience override is configured', async () => {
      const token = mintHs256Token({
        sub: 'custom-user',
        role: 'authenticated',
        aud: 'authenticated',
        iss: 'https://auth.custom-domain.org',
        exp: future,
      });
      let err;
      try {
        await verify(`Bearer ${token}`);
      } catch (e) {
        err = e;
      }
      if (!err || !err.message.includes('audience mismatch')) {
        throw new Error(`Expected audience mismatch error, got: ${err && err.message}`);
      }
    });

    if (relayer.server && relayer.server.listening) {
      await new Promise((resolve) => relayer.server.close(resolve));
    }
  });

  // 21. Explicit Auth API fallback when SUPABASE_AUTH_FALLBACK_TO_API=true
  await withEnv({
    ...baseEnv,
    SUPABASE_AUTH_FALLBACK_TO_API: 'true',
  }, async () => {
    const relayer = loadRelayer();
    const verify = relayer.testHooks.verifySupabaseJwt;
    authApiRequestsCount = 0;

    await test('falls back to Auth API when explicitly configured', async () => {
      const h = b64url(JSON.stringify({ alg: 'custom-alg', typ: 'JWT' }));
      const p = b64url(JSON.stringify({ sub: 'fallback-sub' }));
      const sig = b64url(Buffer.from('sig'));
      const token = `${h}.${p}.${sig}`;

      const claims = await verify(`Bearer ${token}`);
      if (!claims || claims.sub !== 'fallback-user-id') {
        throw new Error(`Expected fallback user claims, got: ${JSON.stringify(claims)}`);
      }
      if (authApiRequestsCount !== 1) {
        throw new Error(`Expected 1 Auth API request, got: ${authApiRequestsCount}`);
      }

      // Short-TTL cache on fallback token verification:
      await verify(`Bearer ${token}`);
      if (authApiRequestsCount !== 1) {
        throw new Error(`Expected Auth API call count to stay 1 on cached token, got: ${authApiRequestsCount}`);
      }
    });

    if (relayer.server && relayer.server.listening) {
      await new Promise((resolve) => relayer.server.close(resolve));
    }
  });

  // 22. Fail-closed at startup when auth is required but no issuer could be derived
  await withEnv({
    ...baseEnv,
    SUPABASE_URL: '',
    SUPABASE_JWT_ISSUER: '',
    RELAYER_AUTH_REQUIRED: 'true',
  }, async () => {
    await test('relayer startup fails closed when auth is enabled without an issuer', async () => {
      let err;
      try {
        loadRelayer();
      } catch (e) {
        err = e;
      }
      if (!err) {
        throw new Error('Expected startup to throw when issuer cannot be derived');
      }
    });
  });

  if (stubSupabase.listening) {
    await new Promise((resolve) => stubSupabase.close(resolve));
  }

  console.log('\n--- Test Results ---');
  let passed = 0;
  for (const [status, name] of results) {
    if (status === 'ok') passed++;
    console.log(`${status === 'ok' ? '✓' : '✗'} ${name}`);
  }
  console.log(`\nTotal: ${results.length}, Passed: ${passed}, Failed: ${results.length - passed}`);
  if (passed !== results.length) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Fatal harness error:', err);
  process.exit(1);
});
