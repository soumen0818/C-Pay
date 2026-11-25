/**
 * Issue #228: Schema consistency: mixed ID types, orphaned rows, no account deletion
 *
 * Tests the deleteAccount service:
 *   - Calls delete_my_account RPC on Supabase
 *   - On success, signs out and wipes all local wallet state
 *   - On failure, propagates error without clearing credentials
 */

import { deleteAccount } from '../../services/auth';
import { supabase } from '../../services/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearWallet } from '../../services/wallet';

jest.mock('../../services/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    auth: {
      signOut: jest.fn().mockResolvedValue({ error: null }),
      getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } }, error: null }),
    },
    storage: {
      from: jest.fn().mockReturnValue({
        remove: jest.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
    removeAllChannels: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../services/transactionMonitor', () => ({
  stopTransactionPolling: jest.fn(),
}));

jest.mock('../../services/wallet', () => ({
  clearSessionPin: jest.fn(),
  clearWallet: jest.fn().mockResolvedValue(undefined),
}));

describe('deleteAccount service (#228)', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await AsyncStorage.setItem('wallet_address', 'GTESTWALLET123');
    await AsyncStorage.setItem('wallet_pin', '1234');
    await AsyncStorage.setItem('has_wallet', 'true');
  });

  test('successfully calls delete_my_account RPC and wipes local credentials', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({ data: null, error: null });

    await deleteAccount();

    expect(supabase.rpc).toHaveBeenCalledWith('delete_my_account');
    expect(supabase.storage.from).toHaveBeenCalledWith('profile-images');
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(clearWallet).toHaveBeenCalled();

    const address = await AsyncStorage.getItem('wallet_address');
    const pin = await AsyncStorage.getItem('wallet_pin');
    const hasWallet = await AsyncStorage.getItem('has_wallet');

    expect(address).toBeNull();
    expect(pin).toBeNull();
    expect(hasWallet).toBeNull();
  });

  test('fails and preserves local state when delete_my_account RPC errors', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: null,
      error: { message: 'Database error deleting account' },
    });

    await expect(deleteAccount()).rejects.toEqual({
      message: 'Database error deleting account',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('delete_my_account');
    expect(supabase.auth.signOut).not.toHaveBeenCalled();

    const address = await AsyncStorage.getItem('wallet_address');
    expect(address).toBe('GTESTWALLET123');
  });
});
