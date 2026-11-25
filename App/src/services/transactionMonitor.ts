import { Logger } from '../utils/logger';
import { getTransactionStatus, isValidTransactionHash, waitForTransaction } from './blockchain';
import { updateTransactionStatus, getTransactions } from './storage';

/**
 * Background service to poll pending transactions and update their status
 * This runs independently and updates Supabase, which triggers real-time updates
 */

let isPolling = false;
let pollingInterval: NodeJS.Timeout | null = null;

// A submitted hash that Horizon still cannot find after this window is not a
// pending ledger transaction. Keep the window aligned with the foreground
// confirmation flow (24 × 2.5s + 12 × 5s).
export const TRANSACTION_NOT_FOUND_TIMEOUT_MS = 120_000;
const NOT_FOUND_FAILURE_REASON = 'Transaction was not found on Stellar before confirmation timed out.';

/**
 * Check status of a single transaction and update if confirmed
 * Phase 2: Updated to handle internal_status and user_visible_status
 */
export async function checkTransactionStatus(txHash: string): Promise<string> {
  try {
    if (!isValidTransactionHash(txHash)) {
      return 'unknown';
    }

    const status = await getTransactionStatus(txHash);
    
    if (status === 'success') {
      await updateTransactionStatus(
        txHash,
        'success',
        'confirmed',
        new Date().toISOString()
      );
    } else if (status === 'failed') {
      await updateTransactionStatus(
        txHash,
        'failed',
        'failed',
        undefined,
        'Transaction failed on blockchain'
      );
    }
    return status;
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Poll all pending transactions and update their status
 */
export async function pollPendingTransactions(): Promise<void> {
  try {
    const transactions = await getTransactions();
    const pendingTxs = transactions.filter(tx =>
      tx.status === 'pending' && isValidTransactionHash(tx.tx_hash)
    );
    
    if (pendingTxs.length === 0) {
      return;
    }
    
    
    // Check each pending transaction
    for (const tx of pendingTxs) {
      const status = await checkTransactionStatus(tx.tx_hash);
      if (status === 'not_found' && hasNotFoundTimedOut(tx)) {
        await updateTransactionStatus(
          tx.tx_hash,
          'failed',
          'failed',
          undefined,
          NOT_FOUND_FAILURE_REASON
        );
      }
    }
  } catch (error) {
  }
}

/**
 * Start automatic polling of pending transactions
 * Polls every 10 seconds by default
 */
export function startTransactionPolling(intervalMs: number = 10000): void {
  if (isPolling) {
    return;
  }
  
  isPolling = true;
  
  // Poll immediately
  pollPendingTransactions();
  
  // Then poll at intervals
  pollingInterval = setInterval(() => {
    pollPendingTransactions();
  }, intervalMs);
}

/**
 * Stop automatic polling
 */
export function stopTransactionPolling(): void {
  if (!isPolling) {
    return;
  }
  
  isPolling = false;
  
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/**
 * Wait for a specific transaction to be confirmed
 * Returns the final status
 * Phase 2: Updated to handle new status fields
 */
export async function waitForTransactionConfirmation(
  txHash: string,
  maxAttempts: number = 60,
  intervalMs: number = 5000
): Promise<'success' | 'failed' | 'timeout'> {
  let wasNotFound = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await getTransactionStatus(txHash);
    
    if (status === 'success') {
      await updateTransactionStatus(
        txHash,
        'success',
        'confirmed',
        new Date().toISOString()
      );
      return 'success';
    } else if (status === 'failed') {
      await updateTransactionStatus(
        txHash,
        'failed',
        'failed',
        undefined,
        'Transaction failed on blockchain'
      );
      return 'failed';
    }

    wasNotFound ||= status === 'not_found';
    
    // Wait before next attempt
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  
  // A Horizon 404 means the submitted hash never reached the network. Unlike
  // a transient transport error, it can safely become a terminal failure once
  // the confirmation window has elapsed.
  if (wasNotFound) {
    await updateTransactionStatus(
      txHash,
      'failed',
      'failed',
      undefined,
      NOT_FOUND_FAILURE_REASON
    );
  }

  return 'timeout';
}

function hasNotFoundTimedOut(tx: { created_at?: string; submitted_at?: string }): boolean {
  const submittedAt = tx.submitted_at || tx.created_at;
  const submittedAtMs = submittedAt ? new Date(submittedAt).getTime() : NaN;
  return Number.isFinite(submittedAtMs)
    && Date.now() - submittedAtMs >= TRANSACTION_NOT_FOUND_TIMEOUT_MS;
}

/**
 * Smart transaction monitoring
 * Tries waitForTransaction first (fast), then falls back to polling
 * Phase 2: Updated to handle new status fields
 */
export async function monitorTransaction(txHash: string): Promise<void> {
  try {
    
    // Try to wait for transaction (1 confirmation)
    const receipt = await waitForTransaction(txHash, 1);
    
    if (receipt) {
      const status = receipt.status === 1 ? 'success' : 'failed';
      const confirmedAt = new Date().toISOString();
      
      await updateTransactionStatus(
        txHash,
        status,
        status === 'success' ? 'confirmed' : 'failed',
        status === 'success' ? confirmedAt : undefined,
        status === 'failed' ? 'Transaction failed on blockchain' : undefined
      );
    } else {
      // Fallback to polling if waitForTransaction fails
      await waitForTransactionConfirmation(txHash, 12, 5000); // Poll for 60s
    }
  } catch (error) {
    // Fallback to polling
    await waitForTransactionConfirmation(txHash, 12, 5000);
  }
}
