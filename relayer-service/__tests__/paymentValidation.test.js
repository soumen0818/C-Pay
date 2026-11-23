'use strict';

const StellarSdk = require('@stellar/stellar-sdk');
const {
  assertTransactionEnvelopeXdr,
  validateTransactionMemo,
  validatePaymentTransaction,
  checkDestinationTrustline,
  ALLOWED_MEMO_TYPES,
  MAX_MEMO_TEXT_BYTES,
  DEFAULT_MAX_TIMEBOUND_MINUTES,
} = require('../paymentValidation');

describe('Payment Validation & Security Enforcement', () => {
  const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const usdcAsset = new StellarSdk.Asset('USDC', TESTNET_USDC_ISSUER);

  const sourceKeypair = StellarSdk.Keypair.random();
  const destKeypair = StellarSdk.Keypair.random();
  const sourceAccount = new StellarSdk.Account(sourceKeypair.publicKey(), '100');

  function buildTestTransaction({
    source = sourceAccount,
    destination = destKeypair.publicKey(),
    amount = '25.50',
    asset = usdcAsset,
    timebounds = { minTime: 0, maxTime: Math.floor(Date.now() / 1000) + 300 },
    memo = StellarSdk.Memo.none(),
    operationType = 'payment',
    extraOps = false,
    opSource = null,
  } = {}) {
    let builder;
    if (timebounds) {
      builder = new StellarSdk.TransactionBuilder(source, {
        fee: '100',
        networkPassphrase: StellarSdk.Networks.TESTNET,
        timebounds,
      });
    } else {
      builder = new StellarSdk.TransactionBuilder(source, {
        fee: '100',
        networkPassphrase: StellarSdk.Networks.TESTNET,
      });
      builder.setTimeout(StellarSdk.TimeoutInfinite);
    }

    if (operationType === 'payment') {
      builder.addOperation(StellarSdk.Operation.payment({
        destination,
        asset,
        amount,
        ...(opSource ? { source: opSource } : {}),
      }));
    } else if (operationType === 'createAccount') {
      builder.addOperation(StellarSdk.Operation.createAccount({
        destination,
        startingBalance: '10',
      }));
    }

    if (extraOps) {
      builder.addOperation(StellarSdk.Operation.payment({
        destination,
        asset,
        amount: '1.00',
      }));
    }

    if (memo) {
      builder.addMemo(memo);
    }

    return builder.build();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 1. XDR Parser (Base64 XDR only; hex & byte strings rejected)
  // ─────────────────────────────────────────────────────────────────────────
  describe('assertTransactionEnvelopeXdr (Base64 strict parsing)', () => {
    let validTx;
    let validBase64Xdr;

    beforeAll(() => {
      validTx = buildTestTransaction();
      validBase64Xdr = validTx.toXDR();
    });

    test('accepts valid base64 TransactionEnvelope XDR', () => {
      const result = assertTransactionEnvelopeXdr(validBase64Xdr);
      expect(result).toBe(validBase64Xdr);
    });

    test('rejects non-string values', () => {
      expect(() => assertTransactionEnvelopeXdr(null)).toThrow('Invalid transaction XDR');
      expect(() => assertTransactionEnvelopeXdr(undefined)).toThrow('Invalid transaction XDR');
      expect(() => assertTransactionEnvelopeXdr(12345)).toThrow('Invalid transaction XDR');
      expect(() => assertTransactionEnvelopeXdr({ signedXdr: validBase64Xdr })).toThrow('Invalid transaction XDR');
    });

    test('rejects strings shorter than 20 characters', () => {
      expect(() => assertTransactionEnvelopeXdr('AAAA')).toThrow('Invalid transaction XDR');
      expect(() => assertTransactionEnvelopeXdr('   short   ')).toThrow('Invalid transaction XDR');
    });

    test('rejects strings longer than 20000 characters', () => {
      const oversized = 'A'.repeat(20004);
      expect(() => assertTransactionEnvelopeXdr(oversized)).toThrow('Invalid transaction XDR');
    });

    test('rejects hex-encoded XDR (eliminating unnecessary parsing surface)', () => {
      const hexXdr = Buffer.from(validBase64Xdr, 'base64').toString('hex');
      expect(() => assertTransactionEnvelopeXdr(hexXdr)).toThrow(/Invalid transaction XDR/);
    });

    test('rejects comma-separated byte strings (eliminating unnecessary parsing surface)', () => {
      const bytes = Array.from(Buffer.from(validBase64Xdr, 'base64')).join(',');
      expect(() => assertTransactionEnvelopeXdr(bytes)).toThrow(/Invalid transaction XDR/);
    });

    test('rejects non-base64 characters', () => {
      const invalidChars = validBase64Xdr.slice(0, -4) + '@@==';
      expect(() => assertTransactionEnvelopeXdr(invalidChars)).toThrow(/Invalid transaction XDR/);
    });

    test('rejects base64 strings with invalid length not multiple of 4', () => {
      const badLength = validBase64Xdr.slice(0, -1);
      expect(() => assertTransactionEnvelopeXdr(badLength)).toThrow(/Invalid transaction XDR/);
    });

    test('rejects valid base64 that is not a transaction envelope', () => {
      const randomBase64 = Buffer.from('this is not a stellar transaction envelope at all!').toString('base64');
      // pad to multiple of 4 if needed
      const padded = randomBase64.padEnd(Math.ceil(randomBase64.length / 4) * 4, '=');
      expect(() => assertTransactionEnvelopeXdr(padded)).toThrow('Invalid transaction XDR');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Memo Policy Validation
  // ─────────────────────────────────────────────────────────────────────────
  describe('validateTransactionMemo (Memo policy)', () => {
    test('accepts Memo.none', () => {
      expect(() => validateTransactionMemo(StellarSdk.Memo.none())).not.toThrow();
    });

    test('accepts Memo.text with up to 28 bytes', () => {
      expect(() => validateTransactionMemo(StellarSdk.Memo.text('hello'))).not.toThrow();
      expect(() => validateTransactionMemo(StellarSdk.Memo.text('a'.repeat(28)))).not.toThrow();
      expect(() => validateTransactionMemo(StellarSdk.Memo.text(''))).not.toThrow();
    });

    test('rejects Memo.text exceeding 28 bytes', () => {
      const memo = { type: 'text', value: 'a'.repeat(29) };
      expect(() => validateTransactionMemo(memo)).toThrow(/exceeds maximum allowed length of 28 bytes/);
      try {
        validateTransactionMemo(memo);
      } catch (err) {
        expect(err.code).toBe('MEMO_TEXT_TOO_LONG');
        expect(err.statusCode).toBe(400);
      }
    });

    test('rejects Memo.text when value is not a string', () => {
      const memo = { type: 'text', value: 12345 };
      expect(() => validateTransactionMemo(memo)).toThrow('Memo text must be a string');
    });

    test('accepts Memo.id with valid 64-bit integer strings', () => {
      expect(() => validateTransactionMemo(StellarSdk.Memo.id('0'))).not.toThrow();
      expect(() => validateTransactionMemo(StellarSdk.Memo.id('123456789'))).not.toThrow();
      expect(() => validateTransactionMemo(StellarSdk.Memo.id('18446744073709551615'))).not.toThrow(); // uint64 max
    });

    test('rejects Memo.id with non-numeric strings', () => {
      const memo = { type: 'id', value: '123a' };
      expect(() => validateTransactionMemo(memo)).toThrow('Memo ID must be a valid non-negative integer string');
      try {
        validateTransactionMemo(memo);
      } catch (err) {
        expect(err.code).toBe('INVALID_MEMO_ID');
      }
    });

    test('rejects Memo.id exceeding uint64 max', () => {
      const memo = { type: 'id', value: '18446744073709551616' }; // uint64 max + 1
      expect(() => validateTransactionMemo(memo)).toThrow('Memo ID out of range for uint64');
      try {
        validateTransactionMemo(memo);
      } catch (err) {
        expect(err.code).toBe('INVALID_MEMO_ID');
      }
    });

    test('accepts Memo.hash with 32-byte Buffer or 64-char hex string', () => {
      const buf = Buffer.alloc(32, 1);
      expect(() => validateTransactionMemo(StellarSdk.Memo.hash(buf))).not.toThrow();
      expect(() => validateTransactionMemo({ type: 'hash', value: buf.toString('hex') })).not.toThrow();
    });

    test('rejects Memo.hash with invalid buffer length or non-hex string', () => {
      expect(() => validateTransactionMemo({ type: 'hash', value: Buffer.alloc(16) })).toThrow(/Memo hash must be/);
      expect(() => validateTransactionMemo({ type: 'hash', value: 'invalid-hex-string' })).toThrow(/Memo hash must be/);
      try {
        validateTransactionMemo({ type: 'hash', value: 'deadbeef' });
      } catch (err) {
        expect(err.code).toBe('INVALID_MEMO_HASH');
      }
    });

    test('rejects Memo.return (unsupported memo type in payment policy)', () => {
      const memo = new StellarSdk.Memo(StellarSdk.MemoReturn, Buffer.alloc(32));
      expect(() => validateTransactionMemo(memo)).toThrow('Unsupported memo type: return');
      try {
        validateTransactionMemo(memo);
      } catch (err) {
        expect(err.code).toBe('UNSUPPORTED_MEMO_TYPE');
        expect(err.statusCode).toBe(400);
      }
    });

    test('rejects arbitrary or unknown memo types', () => {
      expect(() => validateTransactionMemo({ type: 'custom_secret' })).toThrow('Unsupported memo type: custom_secret');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Self-Payment & Structural Payment Rejections
  // ─────────────────────────────────────────────────────────────────────────
  describe('validatePaymentTransaction (Self-payment & structural checks)', () => {
    test('rejects self-payment when destination equals source', async () => {
      const selfPaymentTx = buildTestTransaction({
        source: sourceAccount,
        destination: sourceAccount.accountId(), // destination === source
      });

      await expect(validatePaymentTransaction(selfPaymentTx)).rejects.toMatchObject({
        message: 'Self-payments are not permitted',
        statusCode: 400,
        code: 'SELF_PAYMENT_PROHIBITED',
      });
    });

    test('rejects when transaction source is missing', async () => {
      const tx = buildTestTransaction();
      const rawTx = Object.create(tx);
      Object.defineProperty(rawTx, 'source', { value: '' });

      await expect(validatePaymentTransaction(rawTx)).rejects.toMatchObject({
        message: 'Transaction source is required',
        statusCode: 400,
      });
    });

    test('rejects when operations count is not 1', async () => {
      const tx = buildTestTransaction({ extraOps: true });
      await expect(validatePaymentTransaction(tx)).rejects.toMatchObject({
        message: 'Payment transaction must contain exactly one operation',
        statusCode: 400,
      });
    });

    test('rejects when operation is not a payment operation', async () => {
      const tx = buildTestTransaction({ operationType: 'createAccount' });
      await expect(validatePaymentTransaction(tx)).rejects.toMatchObject({
        message: 'Only payment operations are accepted',
        statusCode: 400,
      });
    });

    test('rejects when operation source does not match transaction source', async () => {
      const otherKeypair = StellarSdk.Keypair.random();
      const tx = buildTestTransaction({ opSource: otherKeypair.publicKey() });
      await expect(validatePaymentTransaction(tx)).rejects.toMatchObject({
        message: 'Payment operation source must match transaction source',
        statusCode: 400,
      });
    });

    test('rejects when asset is not the supported USDC asset', async () => {
      const unsupportedAsset = new StellarSdk.Asset('USDC', StellarSdk.Keypair.random().publicKey());
      const tx = buildTestTransaction({ asset: unsupportedAsset });
      await expect(validatePaymentTransaction(tx)).rejects.toMatchObject({
        message: 'Payment asset is not supported',
        statusCode: 400,
      });
    });

    test('rejects when destination is not a valid Stellar Ed25519 public key', async () => {
      const tx = buildTestTransaction();
      tx.operations[0].destination = 'INVALID_ACCOUNT_ID';
      await expect(validatePaymentTransaction(tx)).rejects.toMatchObject({
        message: 'Invalid Stellar destination',
        statusCode: 400,
      });
    });

    test('rejects when amount exceeds maxPaymentAmount limit', async () => {
      const tx = buildTestTransaction({ amount: '5000.00' });
      await expect(validatePaymentTransaction(tx, { maxPaymentAmount: 1000 })).rejects.toMatchObject({
        code: 'PAYMENT_AMOUNT_EXCEEDED',
        statusCode: 400,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Time Bounds Enforcement (maxTime within N minutes)
  // ─────────────────────────────────────────────────────────────────────────
  describe('validatePaymentTransaction (Time bounds enforcement)', () => {
    const fixedNow = 1_700_000_000; // fixed test timestamp in seconds

    test('rejects transaction when timeBounds is missing (null/undefined)', async () => {
      const tx = buildTestTransaction();
      Object.defineProperty(tx, 'timeBounds', { value: null });

      await expect(validatePaymentTransaction(tx, { now: fixedNow })).rejects.toMatchObject({
        message: 'Payment transaction must specify an upper time bound (maxTime)',
        code: 'MISSING_TIME_BOUNDS',
        statusCode: 400,
      });
    });

    test('rejects transaction when maxTime is 0 or "0" (indefinitely valid)', async () => {
      const tx = buildTestTransaction({ timebounds: { minTime: 0, maxTime: 0 } });

      await expect(validatePaymentTransaction(tx, { now: fixedNow })).rejects.toMatchObject({
        message: 'Payment transaction must specify an upper time bound (maxTime)',
        code: 'MISSING_TIME_BOUNDS',
        statusCode: 400,
      });
    });

    test('rejects transaction when maxTime has already expired (in the past)', async () => {
      const expiredMaxTime = fixedNow - 10; // expired 10 seconds ago
      const tx = buildTestTransaction({
        timebounds: { minTime: 0, maxTime: expiredMaxTime },
      });

      await expect(validatePaymentTransaction(tx, { now: fixedNow })).rejects.toMatchObject({
        message: 'Payment transaction has already expired',
        code: 'TIME_BOUNDS_EXPIRED',
        statusCode: 400,
      });
    });

    test('rejects transaction when maxTime exceeds maximum allowed window of N minutes', async () => {
      const maxMinutes = 15;
      const tooFarMaxTime = fixedNow + (16 * 60); // 16 minutes in future (> 15 min window)
      const tx = buildTestTransaction({
        timebounds: { minTime: 0, maxTime: tooFarMaxTime },
      });

      await expect(
        validatePaymentTransaction(tx, { now: fixedNow, maxTimeboundMinutes: maxMinutes })
      ).rejects.toMatchObject({
        message: `Payment transaction maxTime exceeds maximum allowed window of ${maxMinutes} minutes`,
        code: 'TIME_BOUNDS_WINDOW_EXCEEDED',
        statusCode: 400,
      });
    });

    test('rejects transaction when minTime is in the future', async () => {
      const futureMinTime = fixedNow + 60; // valid starting 60s from now
      const tx = buildTestTransaction({
        timebounds: { minTime: futureMinTime, maxTime: fixedNow + 300 },
      });

      await expect(validatePaymentTransaction(tx, { now: fixedNow })).rejects.toMatchObject({
        message: 'Payment transaction minTime is in the future',
        code: 'TIME_BOUNDS_NOT_YET_VALID',
        statusCode: 400,
      });
    });

    test('accepts transaction with maxTime within the allowed N minutes window', async () => {
      const validMaxTime = fixedNow + 60; // 1 minute in future (default app behavior)
      const tx = buildTestTransaction({
        timebounds: { minTime: 0, maxTime: validMaxTime },
      });

      const result = await validatePaymentTransaction(tx, { now: fixedNow, maxTimeboundMinutes: 15 });
      expect(result).toEqual({
        source: sourceAccount.accountId(),
        destination: destKeypair.publicKey(),
        amount: tx.operations[0].amount,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Destination Account & Trustline Pre-check
  // ─────────────────────────────────────────────────────────────────────────
  describe('validatePaymentTransaction (Destination account & trustline pre-check)', () => {
    test('rejects when destination account does not exist on Horizon (404)', async () => {
      const tx = buildTestTransaction();
      const mockServer = {
        loadAccount: jest.fn().mockRejectedValue({ response: { status: 404 } }),
      };

      await expect(
        validatePaymentTransaction(tx, { server: mockServer, checkDestination: true })
      ).rejects.toMatchObject({
        message: 'Destination account does not exist',
        code: 'DESTINATION_ACCOUNT_NOT_FOUND',
        statusCode: 400,
      });
      expect(mockServer.loadAccount).toHaveBeenCalledWith(destKeypair.publicKey());
    });

    test('rejects when destination account exists but lacks USDC trustline', async () => {
      const tx = buildTestTransaction();
      const mockServer = {
        loadAccount: jest.fn().mockResolvedValue({
          sequence: '10',
          balances: [
            { asset_type: 'native', balance: '100' }, // only XLM, no USDC
          ],
        }),
      };

      await expect(
        validatePaymentTransaction(tx, { server: mockServer, checkDestination: true })
      ).rejects.toMatchObject({
        message: 'Destination account does not have a USDC trustline',
        code: 'DESTINATION_MISSING_TRUSTLINE',
        statusCode: 400,
      });
      expect(mockServer.loadAccount).toHaveBeenCalledWith(destKeypair.publicKey());
    });

    test('accepts when destination exists and has an active USDC trustline', async () => {
      const tx = buildTestTransaction();
      const mockServer = {
        loadAccount: jest.fn().mockResolvedValue({
          sequence: '10',
          balances: [
            { asset_type: 'native', balance: '100' },
            {
              asset_code: 'USDC',
              asset_issuer: TESTNET_USDC_ISSUER,
              balance: '500',
            },
          ],
        }),
      };

      const result = await validatePaymentTransaction(tx, {
        server: mockServer,
        checkDestination: true,
      });
      expect(result).toEqual({
        source: sourceAccount.accountId(),
        destination: destKeypair.publicKey(),
        amount: tx.operations[0].amount,
      });
    });

    test('skips destination check when checkDestination is explicitly false', async () => {
      const tx = buildTestTransaction();
      const mockServer = {
        loadAccount: jest.fn(),
      };

      const result = await validatePaymentTransaction(tx, {
        server: mockServer,
        checkDestination: false,
      });
      expect(result.destination).toBe(destKeypair.publicKey());
      expect(mockServer.loadAccount).not.toHaveBeenCalled();
    });
  });
});
