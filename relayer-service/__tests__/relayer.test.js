'use strict';

/**
 * Relayer production exports and security tests.
 *
 * Imports directly from production modules (app.js, paymentValidation.js)
 * and tests the real exported implementations rather than copy-pasted inlines.
 */

const crypto = require('crypto');
const StellarSdk = require('@stellar/stellar-sdk');
const createApp = require('../app');
const {
  validatePaymentTransaction,
  assertTransactionEnvelopeXdr,
  validateTransactionMemo,
} = require('../paymentValidation');

const { normalizeAmount, normalizeOptionalString } = createApp;

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalizeAmount (Real production export)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeAmount (production export)', () => {
  const MAX = 1000;

  test('accepts a valid integer amount string', () => {
    expect(normalizeAmount('100', MAX)).toBe('100');
  });

  test('accepts a decimal amount with up to 7 places', () => {
    expect(normalizeAmount('99.9999999', MAX)).toBe('99.9999999');
  });

  test('accepts the maximum amount exactly', () => {
    expect(normalizeAmount('1000', MAX)).toBe('1000');
  });

  test('rejects zero', () => {
    expect(() => normalizeAmount('0', MAX)).toThrow();
  });

  test('rejects negative amounts', () => {
    expect(() => normalizeAmount('-1', MAX)).toThrow();
  });

  test('rejects amounts above the maximum', () => {
    expect(() => normalizeAmount('1001', MAX)).toThrow();
  });

  test('rejects amounts with more than 7 decimal places', () => {
    expect(() => normalizeAmount('1.12345678', MAX)).toThrow();
  });

  test('rejects alphabetic input', () => {
    expect(() => normalizeAmount('abc', MAX)).toThrow();
  });

  test('rejects empty string', () => {
    expect(() => normalizeAmount('', MAX)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. normalizeOptionalString (Real production export)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeOptionalString (production export)', () => {
  test('trims whitespace', () => {
    expect(normalizeOptionalString('  hello  ')).toBe('hello');
  });

  test('returns empty string for undefined', () => {
    expect(normalizeOptionalString(undefined)).toBe('');
  });

  test('returns empty string for null', () => {
    expect(normalizeOptionalString(null)).toBe('');
  });

  test('returns empty string for whitespace-only', () => {
    expect(normalizeOptionalString('   ')).toBe('');
  });

  test('preserves non-whitespace content', () => {
    expect(normalizeOptionalString('key-abc')).toBe('key-abc');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. HS256 JWT verification (Real production verifySupabaseJwt via testHooks)
// ─────────────────────────────────────────────────────────────────────────────

describe('verifySupabaseJwt (production export)', () => {
  const SECRET = 'test-jwt-secret-that-meets-length-requirements-minimum-32-chars';
  const USER_ID = 'user-uuid-1234';

  function makeHs256Token(payload, secret) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  function validToken(overrides = {}) {
    const claims = {
      sub: USER_ID,
      role: 'authenticated',
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    };
    return makeHs256Token(claims, SECRET);
  }

  let app;
  beforeAll(() => {
    app = createApp({
      config: {
        supabaseJwtSecret: SECRET,
        supabaseJwtAudience: 'authenticated',
        authRequired: true,
      },
    });
  });

  test('accepts a valid HS256 token', async () => {
    const claims = await app.testHooks.verifySupabaseJwt(`Bearer ${validToken()}`);
    expect(claims.sub).toBe(USER_ID);
    expect(claims.role).toBe('authenticated');
  });

  test('rejects a missing Authorization header', async () => {
    await expect(app.testHooks.verifySupabaseJwt('')).rejects.toThrow('Authentication required');
  });

  test('rejects a malformed header (no Bearer prefix)', async () => {
    await expect(app.testHooks.verifySupabaseJwt(validToken())).rejects.toThrow('Authentication required');
  });

  test('rejects a token with an invalid signature', async () => {
    const token = validToken();
    const tampered = token.slice(0, -4) + 'XXXX';
    await expect(app.testHooks.verifySupabaseJwt(`Bearer ${tampered}`)).rejects.toThrow();
  });

  test('rejects an expired token', async () => {
    const expiredToken = validToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    await expect(app.testHooks.verifySupabaseJwt(`Bearer ${expiredToken}`)).rejects.toThrow('Expired');
  });

  test('rejects a token missing the sub claim', async () => {
    const noSub = makeHs256Token({ role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' }, SECRET);
    await expect(app.testHooks.verifySupabaseJwt(`Bearer ${noSub}`)).rejects.toThrow();
  });

  test('rejects a non-authenticated role', async () => {
    const anonToken = validToken({ role: 'anon' });
    await expect(app.testHooks.verifySupabaseJwt(`Bearer ${anonToken}`)).rejects.toThrow('Authenticated user token required');
  });

  test('rejects a token signed with a different secret', async () => {
    const token = makeHs256Token({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }, 'wrong-secret-32-chars-long-padding-here');
    await expect(app.testHooks.verifySupabaseJwt(`Bearer ${token}`)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Stellar key validation (Stellar SDK production validation)
// ─────────────────────────────────────────────────────────────────────────────

describe('Stellar key validation', () => {
  test('valid Ed25519 public key passes', () => {
    const kp = StellarSdk.Keypair.random();
    expect(StellarSdk.StrKey.isValidEd25519PublicKey(kp.publicKey())).toBe(true);
  });

  test('invalid public key string fails', () => {
    expect(StellarSdk.StrKey.isValidEd25519PublicKey('not-a-key')).toBe(false);
    expect(StellarSdk.StrKey.isValidEd25519PublicKey('')).toBe(false);
  });

  test('valid Ed25519 secret seed passes', () => {
    const kp = StellarSdk.Keypair.random();
    expect(StellarSdk.StrKey.isValidEd25519SecretSeed(kp.secret())).toBe(true);
  });

  test('invalid secret seed string fails', () => {
    expect(StellarSdk.StrKey.isValidEd25519SecretSeed('not-a-secret')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Production Payment Validation Helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('Payment Validation production helpers', () => {
  test('assertTransactionEnvelopeXdr accepts valid base64 and rejects hex/byte arrays', () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '100');
    const validTx = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: 'Test SDF Network ; September 2015',
    })
      .addOperation(StellarSdk.Operation.payment({
        destination: StellarSdk.Keypair.random().publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: '10',
      }))
      .setTimeout(300)
      .build();
    const validBase64 = validTx.toXDR();
    expect(assertTransactionEnvelopeXdr(validBase64)).toBe(validBase64);

    expect(() => assertTransactionEnvelopeXdr('4141414141414141414141414141414141414141')).toThrow(/Invalid transaction XDR/);
    expect(() => assertTransactionEnvelopeXdr('[65, 65, 65, 65, 65, 65, 65, 65, 65, 65, 65]')).toThrow(/Invalid transaction XDR/);
    expect(() => assertTransactionEnvelopeXdr('')).toThrow();
  });

  test('validateTransactionMemo enforces text and id memo policies', () => {
    expect(() => validateTransactionMemo(StellarSdk.Memo.text('hello'))).not.toThrow();
    expect(() => validateTransactionMemo(StellarSdk.Memo.none())).not.toThrow();
    expect(() => validateTransactionMemo(StellarSdk.Memo.hash(Buffer.alloc(32)))).not.toThrow();
    expect(() => validateTransactionMemo(StellarSdk.Memo.return(Buffer.alloc(32)))).toThrow(/Unsupported memo type/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Idempotency Lock Coordination (Real production acquireIdempotencyLock)
// ─────────────────────────────────────────────────────────────────────────────

describe('Production Idempotency Lock Coordination', () => {
  test('acquires idempotency lock and rejects duplicate concurrent requests', async () => {
    const persistenceMap = new Map();
    const fakeSupabase = {
      async request(path, options = {}) {
        if (path.startsWith('relayer_idempotency_keys')) {
          if (options.method === 'POST') {
            const body = JSON.parse(options.body);
            if (persistenceMap.has(body.key)) {
              const err = new Error('duplicate key');
              err.status = 409;
              err.code = '23505';
              throw err;
            }
            persistenceMap.set(body.key, body);
            return [];
          }
          if (options.method === 'GET' || !options.method) {
            const parsed = new URL(`https://fake.supabase.co/${path}`);
            const key = (parsed.searchParams.get('key') || '').replace(/^eq\./, '');
            const entry = persistenceMap.get(key);
            return entry ? [entry] : [];
          }
        }
        return [];
      },
    };

    const app = createApp({
      config: {
        supabaseUrl: 'https://fake.supabase.co',
        supabaseServiceRoleKey: 'fake-key',
      },
      supabase: fakeSupabase,
    });

    const key = crypto.randomUUID();
    const first = await app.testHooks.acquireIdempotencyLock(key, 60000);
    expect(first.acquired).toBe(true);

    const second = await app.testHooks.acquireIdempotencyLock(key, 60000);
    expect(second.acquired).toBe(false);
  });

  test('generated UUIDs comply with RFC4122 v4 format', () => {
    const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const testUUID = crypto.randomUUID();
    expect(testUUID).toMatch(UUID_V4_REGEX);
  });
});
