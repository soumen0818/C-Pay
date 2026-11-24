import {
  checkTransactionLimit,
  getTransactionLimitsStatus,
  checkRateLimit,
  resetLimits,
} from '../../services/securityLimits';
import * as blockchain from '../../services/blockchain';

jest.mock('../../services/blockchain', () => {
  const actual = jest.requireActual('../../services/blockchain');
  return {
    ...actual,
    relayerRequest: jest.fn(),
  };
});

describe('securityLimits.ts server-authoritative limits and fail-closed behavior (#114)', () => {
  const mockedRelayerRequest = blockchain.relayerRequest as jest.MockedFunction<typeof blockchain.relayerRequest>;

  beforeEach(async () => {
    jest.clearAllMocks();
    await resetLimits();
  });

  const mockServerLimits = {
    maxAmountPerTransaction: 1000,
    maxDailyAmount: 5000,
    maxTransactionsPerDay: 20,
    maxDailyCount: 20,
    maxRequestsPerMinute: 10,
    amountToday: 500,
    transactionsToday: 2,
    remaining: {
      transactions: 18,
      amount: 4500,
    },
  };

  test('getTransactionLimitsStatus fetches authoritative numbers from /payments/limits', async () => {
    mockedRelayerRequest.mockResolvedValueOnce(mockServerLimits);

    const limits = await getTransactionLimitsStatus();

    expect(mockedRelayerRequest).toHaveBeenCalledWith('/payments/limits');
    expect(limits.maxAmountPerTransaction).toBe(1000);
    expect(limits.maxDailyAmount).toBe(5000);
    expect(limits.maxTransactionsPerDay).toBe(20);
    expect(limits.remaining.amount).toBe(4500);
  });

  test('checkTransactionLimit allows transaction within all server limits', async () => {
    mockedRelayerRequest.mockResolvedValueOnce(mockServerLimits);

    const result = await checkTransactionLimit('100');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('checkTransactionLimit rejects amount exceeding per-transaction cap', async () => {
    mockedRelayerRequest.mockResolvedValueOnce(mockServerLimits);

    const result = await checkTransactionLimit('1500');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Maximum amount per transaction is');
  });

  test('checkTransactionLimit rejects when daily transaction count limit is exhausted', async () => {
    mockedRelayerRequest.mockResolvedValueOnce({
      ...mockServerLimits,
      transactionsToday: 20,
      remaining: {
        transactions: 0,
        amount: 3000,
      },
    });

    const result = await checkTransactionLimit('50');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily transaction limit reached');
  });

  test('checkTransactionLimit rejects when amount exceeds daily remaining cap', async () => {
    mockedRelayerRequest.mockResolvedValueOnce({
      ...mockServerLimits,
      amountToday: 4800,
      remaining: {
        transactions: 10,
        amount: 200,
      },
    });

    const result = await checkTransactionLimit('300');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily amount limit exceeded');
  });

  test('checkTransactionLimit fails closed when relayer service errors out', async () => {
    mockedRelayerRequest.mockRejectedValueOnce(new Error('Network error or relayer offline'));

    const result = await checkTransactionLimit('50');

    // MUST NOT fail open!
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Network error or relayer offline|temporarily unavailable/i);
  });

  test('checkTransactionLimit rejects non-numeric or non-positive amounts', async () => {
    const zeroResult = await checkTransactionLimit('0');
    expect(zeroResult.allowed).toBe(false);

    const negativeResult = await checkTransactionLimit('-10');
    expect(negativeResult.allowed).toBe(false);

    const invalidResult = await checkTransactionLimit('abc');
    expect(invalidResult.allowed).toBe(false);
  });

  test('checkRateLimit enforces velocity and fails closed on error', async () => {
    // Under limit
    const allowed = await checkRateLimit('test_action', 2);
    expect(allowed.allowed).toBe(true);

    // Rate limit fails closed if storage throws
    const AsyncStorageMod = require('@react-native-async-storage/async-storage');
    const AsyncStorage = AsyncStorageMod.default || AsyncStorageMod;
    const originalGetItem = AsyncStorage.getItem;
    AsyncStorage.getItem = jest.fn().mockRejectedValueOnce(new Error('Storage failure'));

    const failClosedResult = await checkRateLimit('failing_action');
    expect(failClosedResult.allowed).toBe(false);
    expect(failClosedResult.reason).toContain('Rate limit verification failed');

    AsyncStorage.getItem = originalGetItem;
  });
});
