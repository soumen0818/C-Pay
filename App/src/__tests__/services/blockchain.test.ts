import { getTransactionStatus, requestAddMoney, sendPayment, transferTokens } from '../../services/blockchain';
import * as StellarSdk from '@stellar/stellar-base';

// Mock global fetch for relayerRequest
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

describe('blockchain.ts idempotency key behavior (#33)', () => {
  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const mockKeypair = StellarSdk.Keypair.random();
  const mockWallet = {
    publicKey: mockKeypair.publicKey(),
    secretKey: mockKeypair.secret(),
    keypair: mockKeypair,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requestAddMoney', () => {
    test('uses provided payment intent idempotency key across retries without timestamp', async () => {
      const intentKey = '12345678-1234-4234-8234-123456789abc';

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ alreadyReady: true }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ hash: 'mock-tx-hash-1' }),
      });

      const hash = await requestAddMoney(mockWallet as any, intentKey);
      expect(hash).toBe('mock-tx-hash-1');

      // Check request to /add-money
      const addMoneyCall = mockFetch.mock.calls.find(call => String(call[0]).includes('/add-money'));
      expect(addMoneyCall).toBeDefined();

      const body = JSON.parse(addMoneyCall[1].body);
      expect(body.idempotencyKey).toBe(intentKey);
      expect(body.idempotencyKey).not.toContain('Date.now');
      expect(body.idempotencyKey).not.toMatch(/\b\d{13}\b/);
    });

    test('generates a UUID v4 idempotency key when none is provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ alreadyReady: true }),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ hash: 'mock-tx-hash-2' }),
      });

      await requestAddMoney(mockWallet as any);

      const addMoneyCall = mockFetch.mock.calls.find(call => String(call[0]).includes('/add-money'));
      const body = JSON.parse(addMoneyCall[1].body);
      expect(body.idempotencyKey).toMatch(UUID_V4_REGEX);
      expect(body.idempotencyKey).not.toMatch(/\b\d{13}\b/);
    });
  });

  describe('sendPayment & transferTokens', () => {
    test('passes intent idempotencyKey in options to /payments/submit', async () => {
      const destinationKeypair = StellarSdk.Keypair.random();
      const destination = destinationKeypair.publicKey();
      const intentKey = 'abcdef01-2345-4678-89ab-cdef01234567';

      // 1. ensureAccountReady -> account check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ alreadyReady: true }),
      });
      // 2. loadHorizonAccount
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: mockWallet.publicKey,
          sequence: '100',
          balances: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '500.0000000' }],
        }),
      });
      // 3. /payments/submit
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ hash: 'tx-payment-hash-1', status: 'success' }),
      });

      const hash = await transferTokens(mockWallet as any, destination, '25.00', {
        idempotencyKey: intentKey,
        note: 'Lunch payment',
      });

      expect(hash).toBe('tx-payment-hash-1');

      const submitCall = mockFetch.mock.calls.find(call => String(call[0]).includes('/payments/submit'));
      expect(submitCall).toBeDefined();

      const body = JSON.parse(submitCall[1].body);
      expect(body.idempotencyKey).toBe(intentKey);
      expect(body.idempotencyKey).not.toMatch(/\b\d{13}\b/);
    });
  });

  test('preserves a not_found status so the monitor can apply its timeout policy', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: 'not_found' }),
    });

    await expect(getTransactionStatus('a'.repeat(64))).resolves.toBe('not_found');
  });
});
