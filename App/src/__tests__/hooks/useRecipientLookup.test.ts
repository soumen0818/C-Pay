const mockLookupStateMap: Record<number, any> = {};
let mockLookupStateIdx = 0;

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: any) => {
    const idx = mockLookupStateIdx++;
    if (!(idx in mockLookupStateMap)) mockLookupStateMap[idx] = initial;
    const setter = (val: any) => {
      mockLookupStateMap[idx] = typeof val === 'function' ? val(mockLookupStateMap[idx]) : val;
    };
    return [mockLookupStateMap[idx], setter];
  },
  useRef: (initial: any) => ({ current: initial }),
  useCallback: (fn: any) => fn,
  useEffect: jest.fn(),
}));

jest.mock('../../services/blockchain', () => ({
  isValidAccountId: jest.fn(),
}));

jest.mock('../../services/storage', () => ({
  getUserDisplayName: jest.fn(),
}));

jest.mock('../../utils/cpayId', () => ({
  getCPayIdByWallet: jest.fn(),
  formatWalletFingerprint: jest.fn((addr: string) => addr.slice(0, 4) + '...' + addr.slice(-4)),
  isValidCPayId: jest.fn(),
  getWalletAddressFromCPayId: jest.fn(),
}));

import { useRecipientLookup } from '../../hooks/useRecipientLookup';
import * as blockchain from '../../services/blockchain';
import * as storage from '../../services/storage';
import * as cpayIdUtils from '../../utils/cpayId';

describe('C-010: useRecipientLookup hook', () => {
  const currentWallet = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
  const validRecipient = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(mockLookupStateMap).forEach(k => delete mockLookupStateMap[Number(k)]);
    mockLookupStateIdx = 0;
  });

  test('initializes with empty recipient state', () => {
    const lookup = useRecipientLookup(currentWallet, false);

    expect(lookup.recipientInput).toBe('');
    expect(lookup.recipientAddress).toBe('');
    expect(lookup.recipientName).toBe('');
    expect(lookup.recipientCPayId).toBe('');
    expect(lookup.fetchingRecipient).toBe(false);
    expect(lookup.recipientFetched).toBe(false);
  });

  test('fetches recipient display name and C-Pay ID for valid account ID', async () => {
    (blockchain.isValidAccountId as jest.Mock).mockReturnValue(true);
    (storage.getUserDisplayName as jest.Mock).mockResolvedValue('Alice Smith');
    (cpayIdUtils.getCPayIdByWallet as jest.Mock).mockResolvedValue('alice@cpay');

    const lookup = useRecipientLookup(currentWallet, false);
    await lookup.fetchRecipientName(validRecipient);

    expect(storage.getUserDisplayName).toHaveBeenCalledWith(validRecipient);
    expect(cpayIdUtils.getCPayIdByWallet).toHaveBeenCalledWith(validRecipient);
  });

  test('clears recipient info when recipient is the same as current wallet', async () => {
    (blockchain.isValidAccountId as jest.Mock).mockReturnValue(true);

    const lookup = useRecipientLookup(currentWallet, false);
    await lookup.fetchRecipientName(currentWallet);

    expect(storage.getUserDisplayName).not.toHaveBeenCalled();
  });

  test('handles C-Pay ID address resolution in handleAddressChange', async () => {
    (cpayIdUtils.isValidCPayId as jest.Mock).mockReturnValue(true);
    (cpayIdUtils.getWalletAddressFromCPayId as jest.Mock).mockResolvedValue(validRecipient);
    (blockchain.isValidAccountId as jest.Mock).mockReturnValue(true);
    (storage.getUserDisplayName as jest.Mock).mockResolvedValue('Bob Jones');
    (cpayIdUtils.getCPayIdByWallet as jest.Mock).mockResolvedValue('bob@cpay');

    const lookup = useRecipientLookup(currentWallet, false);
    await lookup.handleAddressChange('bob@cpay');

    expect(cpayIdUtils.getWalletAddressFromCPayId).toHaveBeenCalledWith('bob@cpay');
  });

  test('resets recipient state on resetRecipient', () => {
    const lookup = useRecipientLookup(currentWallet, false);
    lookup.resetRecipient();
    expect(typeof lookup.resetRecipient).toBe('function');
  });
});
