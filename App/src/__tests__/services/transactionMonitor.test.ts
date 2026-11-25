jest.mock('../../services/blockchain', () => ({
  getTransactionStatus: jest.fn(),
  isValidTransactionHash: jest.fn((hash: string) => /^[a-f0-9]{64}$/i.test(hash)),
  waitForTransaction: jest.fn(),
}));

jest.mock('../../services/storage', () => ({
  getTransactions: jest.fn(),
  updateTransactionStatus: jest.fn(),
}));

import { getTransactionStatus } from '../../services/blockchain';
import { getTransactions, updateTransactionStatus } from '../../services/storage';
import {
  checkTransactionStatus,
  pollPendingTransactions,
  TRANSACTION_NOT_FOUND_TIMEOUT_MS,
  waitForTransactionConfirmation,
} from '../../services/transactionMonitor';

const TX_HASH = 'a'.repeat(64);
const mockedGetStatus = getTransactionStatus as jest.Mock;
const mockedGetTransactions = getTransactions as jest.Mock;
const mockedUpdateStatus = updateTransactionStatus as jest.Mock;

describe('transactionMonitor transaction outcomes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('records a failed Horizon payment as failed in local transaction history', async () => {
    mockedGetStatus.mockResolvedValueOnce('failed');

    await expect(checkTransactionStatus(TX_HASH)).resolves.toBe('failed');

    expect(mockedUpdateStatus).toHaveBeenCalledWith(
      TX_HASH,
      'failed',
      'failed',
      undefined,
      'Transaction failed on blockchain'
    );
  });

  test('marks a hash missing from Horizon as failed after the foreground confirmation window', async () => {
    mockedGetStatus.mockResolvedValueOnce('not_found');

    await expect(waitForTransactionConfirmation(TX_HASH, 1, 0)).resolves.toBe('timeout');

    expect(mockedUpdateStatus).toHaveBeenCalledWith(
      TX_HASH,
      'failed',
      'failed',
      undefined,
      'Transaction was not found on Stellar before confirmation timed out.'
    );
  });

  test('expires an old not_found transaction during background polling', async () => {
    mockedGetTransactions.mockResolvedValueOnce([{
      tx_hash: TX_HASH,
      to_address: 'GRECIPIENT',
      amount: '10.00',
      status: 'pending',
      submitted_at: new Date(Date.now() - TRANSACTION_NOT_FOUND_TIMEOUT_MS).toISOString(),
    }]);
    mockedGetStatus.mockResolvedValueOnce('not_found');

    await pollPendingTransactions();

    expect(mockedUpdateStatus).toHaveBeenCalledWith(
      TX_HASH,
      'failed',
      'failed',
      undefined,
      'Transaction was not found on Stellar before confirmation timed out.'
    );
  });
});
