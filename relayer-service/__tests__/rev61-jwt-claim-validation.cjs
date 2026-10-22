'use strict';

// Issue #175 — the HS256 validator accepts tokens with no `exp` claim and
// never checks `aud` or `iss` on that path.
//
// verifySupabaseJwt() verifies the HMAC signature correctly, but then only
// rejects a token when `claims.exp` is present AND already past. A token
// minted without `exp` is accepted forever. `aud` and `iss` are not checked at
// all on this path, so a token minted for a different audience or issuer is
// accepted as long as it carries the right `sub` and signature.
//
// Impact is deliberately narrow: forging any of this still requires the
// Supabase JWT secret. This is not "an anonymous user can mint a JWT". What it
// does mean is that a leaked or over-scoped token cannot be aged out by
// expiry, and audience/issuer confusion is not caught here.
//
// Only synthetic tokens are used. No real secret or credential appears here.

const http = require('http');
const crypto = require('crypto');
const path = require('path');

const SERVICE_DIR = path.resolve(__dirname, '..');
const JWT_SECRET = 'fixture-jwt-secret-not-a-real-key';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function mintToken(claims, { alg = 'HS256', secret = JWT_SECRET } = {}) {
  const header = b64url(JSON.stringify({ alg, typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(sig)}`;
}

function makeStubSupabase() {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
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
  const modulePath = path.join(SERVICE_DIR, 'server.js');
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

const results = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r
        .then(() => results.push(['ok', name]))
        .catch((e) => results.push(['not ok', name + ' :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)]));
    }
    results.push(['ok', name]);
  } catch (e) {
    results.push(['not ok', name + ' :: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)]);
  }
  return Promise.resolve();
}

async function main() {
  const supa = makeStubSupabase();
  const supaPort = await listen(supa);

  await withEnv(
    {
      SUPABASE_URL: `http://127.0.0.1:${supaPort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-key',
      SUPABASE_JWT_SECRET: JWT_SECRET,
      SUPABASE_JWT_ISSUER: 'https://project.supabase.co/auth/v1',
      RELAYER_AUTH_REQUIRED: 'true',
      SPONSOR_SECRET: 'SDU3KZYP56CCI5ZMPX57SZMUN6HD4KISMOLWRZAZWMBRAUTAH37APZ5G',
      DISTRIBUTION_SECRET: 'SCJHWOMV6PD7CTTVN366N6CHCYUISFJBMT7FAX5L25CL7ESWPPB6EUKG',
      ALLOW_HTTP_HORIZON: 'true',
      ALLOW_CUSTOM_HORIZON: 'true',
      NODE_ENV: 'test',
      LEDGER_INGEST_ENABLED: 'false',
    },
    async () => {
      const relayer = loadRelayer();
      await relayer.startupPromise;
      const verify = relayer.testHooks.verifySupabaseJwt;

      // ── Baseline: no exp claim is accepted ──────────────────────────────
      // This assertion documents the vulnerable behaviour. It only holds when
      // the relayer is running the unpatched validator, so it is skipped on a
      // patched build rather than reported as a failure.
      await check('baseline: a token with no exp claim is accepted', async () => {
        if (process.env.REV56_EXPECT_PATCHED === '1') return;
        const token = mintToken({ sub: 'user-a', role: 'authenticated' });
        const claims = await verify(`Bearer ${token}`);
        if (!claims || claims.sub !== 'user-a') throw new Error('token without exp was rejected');
      });

      // ── Baseline: aud / iss are not checked ─────────────────────────────
      // Documents the vulnerable behaviour: on an unpatched build a foreign
      // audience is accepted. Skipped on a patched build, where defaults are
      // enforced, rather than reported as a failure.
      await check('baseline: a token for a foreign audience is accepted', async () => {
        if (process.env.REV56_EXPECT_PATCHED === '1') return;
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          aud: 'some-other-service',
          iss: 'https://evil.example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        const claims = await verify(`Bearer ${token}`);
        if (!claims || claims.aud !== 'some-other-service') {
          throw new Error('foreign audience token was rejected');
        }
      });

      // ── Positive control: a wrong signature is still rejected ───────────
      await check('control: a token signed with the wrong secret is rejected', async () => {
        const token = mintToken({ sub: 'user-a', role: 'authenticated' }, { secret: 'wrong-secret' });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('wrong-signature token was accepted');
      });

      // ── Positive control: an expired token is rejected ──────────────────
      await check('control: an expired token is rejected', async () => {
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) - 60,
        });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('expired token was accepted');
      });

      // ── Positive control: a non-authenticated role is rejected ──────────
      await check('control: a service_role token is rejected', async () => {
        const token = mintToken({ sub: 'user-a', role: 'service_role' });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('service_role token was accepted');
      });

      // ── Positive control: alg none is rejected ──────────────────────────
      await check('control: an alg=none token is rejected', async () => {
        const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
        const payload = b64url(JSON.stringify({ sub: 'user-a', role: 'authenticated' }));
        const token = `${header}.${payload}.`;
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('alg=none token was accepted');
      });

      // Close the relayer's own listener so the process can exit cleanly.
      if (relayer.server && relayer.server.listening) {
        await new Promise((resolve, reject) =>
          relayer.server.close((err) => (err ? reject(err) : resolve()))
        );
      }
    }
  );

  // ── Patched: exp is required ────────────────────────────────────────────
  await withEnv(
    {
      SUPABASE_URL: `http://127.0.0.1:${supaPort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-key',
      SUPABASE_JWT_SECRET: JWT_SECRET,
      RELAYER_AUTH_REQUIRED: 'true',
      SPONSOR_SECRET: 'SDU3KZYP56CCI5ZMPX57SZMUN6HD4KISMOLWRZAZWMBRAUTAH37APZ5G',
      DISTRIBUTION_SECRET: 'SCJHWOMV6PD7CTTVN366N6CHCYUISFJBMT7FAX5L25CL7ESWPPB6EUKG',
      ALLOW_HTTP_HORIZON: 'true',
      ALLOW_CUSTOM_HORIZON: 'true',
      NODE_ENV: 'test',
      LEDGER_INGEST_ENABLED: 'false',
    },
    async () => {
      const relayer = loadRelayer();
      await relayer.startupPromise;
      const verify = relayer.testHooks.verifySupabaseJwt;

      await check('patched: a token with no exp claim is now rejected', async () => {
        const token = mintToken({ sub: 'user-a', role: 'authenticated' });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('token without exp was still accepted');
      });

      await check('patched: a token with no aud/iss is rejected under defaults', async () => {
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('token with no aud/iss was accepted under defaults');
      });

      await check('patched: a wrong aud is rejected under defaults', async () => {
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          aud: 'someone-else',
          iss: 'https://project.supabase.co/auth/v1',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('wrong aud was accepted under defaults');
      });

      await check('patched: a wrong iss is rejected under defaults', async () => {
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          aud: 'authenticated',
          iss: 'https://evil.example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
        });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('wrong iss was accepted under defaults');
      });

      if (relayer.server && relayer.server.listening) {
        await new Promise((resolve, reject) =>
          relayer.server.close((err) => (err ? reject(err) : resolve()))
        );
      }
    }
  );

  // ── Patched: aud / iss enforced when configured ─────────────────────────
  await withEnv(
    {
      SUPABASE_URL: `http://127.0.0.1:${supaPort}`,
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-key',
      SUPABASE_JWT_SECRET: JWT_SECRET,
      SUPABASE_JWT_AUDIENCE: 'cpay-relayer',
      SUPABASE_JWT_ISSUER: 'https://project.supabase.co/auth/v1',
      RELAYER_AUTH_REQUIRED: 'true',
      SPONSOR_SECRET: 'SDU3KZYP56CCI5ZMPX57SZMUN6HD4KISMOLWRZAZWMBRAUTAH37APZ5G',
      DISTRIBUTION_SECRET: 'SCJHWOMV6PD7CTTVN366N6CHCYUISFJBMT7FAX5L25CL7ESWPPB6EUKG',
      ALLOW_HTTP_HORIZON: 'true',
      ALLOW_CUSTOM_HORIZON: 'true',
      NODE_ENV: 'test',
      LEDGER_INGEST_ENABLED: 'false',
    },
    async () => {
      const relayer = loadRelayer();
      await relayer.startupPromise;
      const verify = relayer.testHooks.verifySupabaseJwt;
      const future = Math.floor(Date.now() / 1000) + 3600;

      await check('patched: a foreign audience is rejected when aud is configured', async () => {
        const token = mintToken({ sub: 'user-a', role: 'authenticated', aud: 'other', exp: future });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('foreign audience was accepted');
      });

      await check('patched: a foreign issuer is rejected when iss is configured', async () => {
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          iss: 'https://evil.example.com',
          exp: future,
        });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('foreign issuer was accepted');
      });

      await check('patched: aud as an array containing the expected value is accepted', async () => {
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          aud: ['other-service', 'cpay-relayer'],
          iss: 'https://project.supabase.co/auth/v1',
          exp: future,
        });
        const claims = await verify(`Bearer ${token}`);
        if (!claims || claims.sub !== 'user-a') throw new Error('array aud was rejected');
      });

      await check('patched: aud as an array without the expected value is rejected', async () => {
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          aud: ['other-service', 'another-service'],
          iss: 'https://project.supabase.co/auth/v1',
          exp: future,
        });
        let threw = false;
        try {
          await verify(`Bearer ${token}`);
        } catch {
          threw = true;
        }
        if (!threw) throw new Error('array aud without expected value was accepted');
      });

      await check('patched: a matching audience and issuer is accepted', async () => {
        const token = mintToken({
          sub: 'user-a',
          role: 'authenticated',
          aud: 'cpay-relayer',
          iss: 'https://project.supabase.co/auth/v1',
          exp: future,
        });
        const claims = await verify(`Bearer ${token}`);
        if (!claims || claims.sub !== 'user-a') throw new Error('matching token was rejected');
      });

      if (relayer.server && relayer.server.listening) {
        await new Promise((resolve, reject) =>
          relayer.server.close((err) => (err ? reject(err) : resolve()))
        );
      }
    }
  );

  if (supa.listening) {
    await new Promise((resolve, reject) => supa.close((err) => (err ? reject(err) : resolve())));
  }

  for (const [status, name] of results) console.log(`${status} ${name}`);
  const failed = results.filter((r) => r[0] === 'not ok').length;
  console.log(`SUMMARY ok=${results.length - failed} notok=${failed} total=${results.length}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exitCode = 1;
});