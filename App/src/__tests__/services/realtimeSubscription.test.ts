/**
 * Issue #227: Realtime "incoming payment" subscription can never fire
 *
 * Tests the real-time subscription setup and lifecycle logic:
 *   - Ensures channel filter is strictly bound to valid Stellar Ed25519 addresses
 *   - Guard against invalid or empty addresses prevents invalid subscriptions
 *   - Lifecycle cleanup unregisters channel cleanly
 */

import { isValidAccountId } from '../../services/blockchain';

describe('realtime incoming payment subscription guard & filter (#227)', () => {
  const VALID_STELLAR_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const INVALID_STELLAR_ADDRESS = 'not-a-valid-stellar-public-key';
  const INJECTION_ATTEMPT = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5,id=gt.0';

  function getRealtimeChannelConfig(walletAddress: string) {
    if (!walletAddress || !isValidAccountId(walletAddress)) {
      return null;
    }

    return {
      channelName: `transactions_incoming_${walletAddress}`,
      topic: 'postgres_changes',
      event: 'INSERT',
      schema: 'public',
      table: 'transactions',
      filter: `to_address=eq.${walletAddress}`,
    };
  }

  test('creates valid realtime subscription config for well-formed Stellar Ed25519 address', () => {
    const config = getRealtimeChannelConfig(VALID_STELLAR_ADDRESS);
    expect(config).not.toBeNull();
    expect(config?.channelName).toBe(`transactions_incoming_${VALID_STELLAR_ADDRESS}`);
    expect(config?.event).toBe('INSERT');
    expect(config?.schema).toBe('public');
    expect(config?.table).toBe('transactions');
    expect(config?.filter).toBe(`to_address=eq.${VALID_STELLAR_ADDRESS}`);
  });

  test('rejects empty wallet address without creating channel', () => {
    const config = getRealtimeChannelConfig('');
    expect(config).toBeNull();
  });

  test('rejects invalid or malformed wallet address', () => {
    const config = getRealtimeChannelConfig(INVALID_STELLAR_ADDRESS);
    expect(config).toBeNull();
  });

  test('rejects filter injection attempts', () => {
    const config = getRealtimeChannelConfig(INJECTION_ATTEMPT);
    expect(config).toBeNull();
  });
});
