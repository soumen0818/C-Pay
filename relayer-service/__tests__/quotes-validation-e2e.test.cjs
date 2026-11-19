'use strict';

/**
 * Regression Test Suite for Issue #176
 *
 * Verifies that:
 * 1. The /quotes and /quotes/validate endpoints are feature-flagged behind ENABLE_QUOTES_API.
 * 2. POST /quotes returns fxRate as a string, attaches ownerId, and HMAC-signs the quote.
 * 3. POST /quotes/validate verifies freshness, owner binding, and HMAC signature.
 * 4. Any modified quote fails validation (tampered amounts, fees, fxRate, expiry, ownerId).
 * 5. Replaying a quote from another user is rejected with QUOTE_OWNER_MISMATCH.
 * 6. Validating an expired quote is rejected with QUOTE_EXPIRED.
 * 7. When QUOTE_SIGNATURE_SECRET is not configured, validation fails closed with QUOTE_SIGNING_NOT_CONFIGURED.
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
        const routes = { GET: {}, POST: {} };
        const middlewares = [];
        const app = function (req, res) {
          req.get = (name) => req.headers[name.toLowerCase()];
          res.status = function (code) {
            this.statusCode = code;
            return this;
          };
          res.json = function (obj) {
            if (!this.headersSent) {
              this.writeHead(this.statusCode || 200, { 'Content-Type': 'application/json' });
            }
            this.end(JSON.stringify(obj));
          };
          let idx = 0;
          function next(err) {
            if (err) {
              for (let j = idx; j < middlewares.length; j++) {
                if (middlewares[j].length === 4) {
                  return middlewares[j](err, req, res, () => {});
                }
              }
              res.status(500).json({ error: err.message });
              return;
            }
            if (idx < middlewares.length) {
              const mw = middlewares[idx++];
              if (mw.length === 4) return next();
              return mw(req, res, next);
            }
            const handler = routes[req.method] && routes[req.method][req.url];
            if (handler) return handler(req, res);
            res.status(404).json({ error: 'not found' });
          }
          next();
        };
        app.use = function (fn) {
          if (typeof fn === 'function') middlewares.push(fn);
        };
        app.get = function (path, ...handlers) {
          routes.GET[path] = (req, res) => {
            let i = 0;
            function step(err) {
              if (err) return;
              if (i < handlers.length) {
                const h = handlers[i++];
                if (h.length >= 3) return h(req, res, step);
                return h(req, res);
              }
            }
            step();
          };
        };
        app.post = function (path, ...handlers) {
          routes.POST[path] = (req, res) => {
            let i = 0;
            function step(err) {
              if (err) return;
              if (i < handlers.length) {
                const h = handlers[i++];
                if (h.length >= 3) return h(req, res, step);
                return h(req, res);
              }
            }
            step();
          };
        };
        app.listen = function (port, host, cb) {
          const s = http.createServer(app);
          s.listen(port, host, () => {
            if (cb) cb();
          });
          return s;
        };
        const expressFn = () => app;
        expressFn.json = () => (req, res, next) => {
          let data = '';
          req.on('data', (c) => (data += c));
          req.on('end', () => {
            try {
              req.body = data ? JSON.parse(data) : {};
            } catch (_) {
              req.body = {};
            }
            next();
          });
        };
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

const JWT_SECRET = 'fixture-jwt-secret';
const QUOTE_SECRET = 'fixture-quote-signing-secret-12345';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mintAuthToken(sub) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    sub,
    role: 'authenticated',
    aud: 'authenticated',
    iss: 'http://127.0.0.1:9999/auth/v1',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest();
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
  const serverPath = path.resolve(__dirname, '..', 'server.js');
  const configPath = path.resolve(__dirname, '..', 'config.js');
  delete require.cache[require.resolve(serverPath)];
  delete require.cache[require.resolve(configPath)];
  return require(serverPath);
}

function makeRequest(port, method, route, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({ host: '127.0.0.1', port, path: route, method, headers }, (res) => {
      let resData = '';
      res.on('data', (c) => (resData += c));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(resData);
        } catch (_) {
          json = null;
        }
        resolve({ status: res.statusCode, body: json, text: resData });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
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
  // Stub Supabase server for startup probe and auth
  const stubSupabase = http.createServer((req, res) => {
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
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-key',
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
    QUOTE_FX_RATES_JSON: '{"USD_INR":90.12345678}',
    PORT: '0',
  };

  // 1. Feature-flagging: disabled by default
  await withEnv({ ...baseEnv, ENABLE_QUOTES_API: 'false' }, async () => {
    const relayer = loadRelayer();
    await relayer.startupPromise;
    const port = relayer.server.address().port;
    const token = mintAuthToken('user-1');

    await test('POST /quotes returns 503 QUOTES_DISABLED when feature flag is disabled', async () => {
      const res = await makeRequest(port, 'POST', '/quotes', { sendAmount: '100.00', sendCurrency: 'USD', receiveCurrency: 'INR' }, token);
      if (res.status !== 503 || res.body?.code !== 'QUOTES_DISABLED') {
        throw new Error(`Expected 503 QUOTES_DISABLED, got ${res.status} ${JSON.stringify(res.body)}`);
      }
    });

    await test('POST /quotes/validate returns 503 QUOTES_DISABLED when feature flag is disabled', async () => {
      const res = await makeRequest(port, 'POST', '/quotes/validate', { sendAmount: '100.00' }, token);
      if (res.status !== 503 || res.body?.code !== 'QUOTES_DISABLED') {
        throw new Error(`Expected 503 QUOTES_DISABLED, got ${res.status} ${JSON.stringify(res.body)}`);
      }
    });

    if (relayer.server && relayer.server.listening) {
      await new Promise((r) => relayer.server.close(r));
    }
  });

  // 2. Enabled with signing configured
  await withEnv({
    ...baseEnv,
    ENABLE_QUOTES_API: 'true',
    QUOTE_SIGNATURE_SECRET: QUOTE_SECRET,
  }, async () => {
    const relayer = loadRelayer();
    await relayer.startupPromise;
    const port = relayer.server.address().port;
    const tokenA = mintAuthToken('user-a');
    const tokenB = mintAuthToken('user-b');

    let genuineQuote;

    await test('POST /quotes creates a signed quote with string fxRate and caller ownerId', async () => {
      const res = await makeRequest(port, 'POST', '/quotes', {
        sendAmount: '100.00',
        sendCurrency: 'USD',
        receiveCurrency: 'INR',
      }, tokenA);

      if (res.status !== 201) {
        throw new Error(`Expected 201, got ${res.status} ${JSON.stringify(res.body)}`);
      }
      genuineQuote = res.body;

      if (typeof genuineQuote.fxRate !== 'string') {
        throw new Error(`Expected fxRate to be string, got ${typeof genuineQuote.fxRate} (${genuineQuote.fxRate})`);
      }
      if (genuineQuote.fxRate !== '90.12345678') {
        throw new Error(`Expected fxRate to be '90.12345678', got '${genuineQuote.fxRate}'`);
      }
      if (genuineQuote.ownerId !== 'user-a') {
        throw new Error(`Expected ownerId to be 'user-a', got '${genuineQuote.ownerId}'`);
      }
      if (!genuineQuote.signature || typeof genuineQuote.signature !== 'string') {
        throw new Error('Expected quote to have a signature string');
      }
    });

    await test('POST /quotes/validate succeeds for genuine quote by genuine owner', async () => {
      const res = await makeRequest(port, 'POST', '/quotes/validate', genuineQuote, tokenA);
      if (res.status !== 200 || !res.body || res.body.signature !== genuineQuote.signature) {
        throw new Error(`Expected 200 with validated quote, got ${res.status} ${JSON.stringify(res.body)}`);
      }
    });

    await test('POST /quotes/validate rejects quote when presented by different owner', async () => {
      const res = await makeRequest(port, 'POST', '/quotes/validate', genuineQuote, tokenB);
      if (res.status !== 403 || res.body?.code !== 'QUOTE_OWNER_MISMATCH') {
        throw new Error(`Expected 403 QUOTE_OWNER_MISMATCH, got ${res.status} ${JSON.stringify(res.body)}`);
      }
    });

    // Tampering tests
    const fieldsToTamper = [
      ['sendAmount', '1.00'],
      ['recipientAmount', '999999.00'],
      ['amountDebited', '1.00'],
      ['fee', '0.00'],
      ['feeBps', 0],
      ['fxRate', '9999.00'],
      ['spreadBps', 100],
      ['receiveCurrency', 'EUR'],
      ['sendCurrency', 'EUR'],
      ['expiresAt', new Date(Date.now() + 86400000).toISOString()],
      ['ownerId', 'user-b'],
      ['signature', 'forged-signature-0000000000000000000000000000000000000000000000000000'],
    ];

    for (const [field, tamperedVal] of fieldsToTamper) {
      await test(`tampering with '${field}' fails validation`, async () => {
        const tampered = { ...genuineQuote, [field]: tamperedVal };
        const res = await makeRequest(port, 'POST', '/quotes/validate', tampered, tokenA);
        if (res.status !== 400 && res.status !== 403) {
          throw new Error(`Expected error for tampered ${field}, got ${res.status} ${JSON.stringify(res.body)}`);
        }
        if (!['QUOTE_SIGNATURE_MISMATCH', 'QUOTE_OWNER_MISMATCH'].includes(res.body?.code)) {
          throw new Error(`Expected signature/owner mismatch error, got ${JSON.stringify(res.body)}`);
        }
      });
    }

    await test('expired quote fails validation with 410 QUOTE_EXPIRED', async () => {
      const expiredQuote = {
        ...genuineQuote,
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      };
      const res = await makeRequest(port, 'POST', '/quotes/validate', expiredQuote, tokenA);
      if (res.status !== 410 || res.body?.code !== 'QUOTE_EXPIRED') {
        throw new Error(`Expected 410 QUOTE_EXPIRED, got ${res.status} ${JSON.stringify(res.body)}`);
      }
    });

    if (relayer.server && relayer.server.listening) {
      await new Promise((r) => relayer.server.close(r));
    }
  });

  // 3. Enabled but without QUOTE_SIGNATURE_SECRET -> fails closed
  await withEnv({
    ...baseEnv,
    ENABLE_QUOTES_API: 'true',
    QUOTE_SIGNATURE_SECRET: '',
  }, async () => {
    const relayer = loadRelayer();
    await relayer.startupPromise;
    const port = relayer.server.address().port;
    const token = mintAuthToken('user-1');

    await test('POST /quotes/validate fails closed (503) when QUOTE_SIGNATURE_SECRET is not configured', async () => {
      const fakeQuote = {
        sendAmount: '100.00',
        sendCurrency: 'USD',
        receiveCurrency: 'INR',
        amountDebited: '101.75',
        fee: '1.75',
        feeBps: 175,
        fxRate: '90.12345678',
        spreadBps: 0,
        recipientAmount: '9012.34',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
      const res = await makeRequest(port, 'POST', '/quotes/validate', fakeQuote, token);
      if (res.status !== 503 || res.body?.code !== 'QUOTE_SIGNING_NOT_CONFIGURED') {
        throw new Error(`Expected 503 QUOTE_SIGNING_NOT_CONFIGURED, got ${res.status} ${JSON.stringify(res.body)}`);
      }
    });

    if (relayer.server && relayer.server.listening) {
      await new Promise((r) => relayer.server.close(r));
    }
  });

  if (stubSupabase.listening) {
    await new Promise((r) => stubSupabase.close(r));
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
