import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../services/supabase';
import {
  extractLast4FromCPayId,
  formatWalletFingerprint,
  getCurrentUserCPayId,
  getWalletFingerprint,
  isValidCPayId,
} from '../../utils/cpayId';

const WALLET_A = 'GBGJS2UIEF2DYN3L67P2A7X62M4WK72JGTF7ABCOQL75UYHMWYLFRI4S';
const WALLET_B = 'GAKUELFFUKSAJMTECN2SVXDRJOUJXDE27OPTD57SA65KJ6AU32SXKF27';

const resetUserQuery = () => {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST116' },
    }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  (supabase.from as jest.Mock).mockReturnValue(query);
  return query;
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetUserQuery();
});

describe('getWalletFingerprint', () => {
  test('returns a deterministic lowercase alphanumeric fingerprint', () => {
    const fingerprint = getWalletFingerprint(WALLET_A);
    expect(fingerprint).toMatch(/^[a-z0-9]+$/);
    expect(fingerprint).toHaveLength(6);
    expect(getWalletFingerprint(WALLET_A)).toBe(fingerprint);
    expect(getWalletFingerprint(WALLET_A.toLowerCase())).toBe(fingerprint);
  });

  test('supports custom lengths and formats the display fallback', () => {
    expect(getWalletFingerprint(WALLET_A, 4)).toHaveLength(4);
    expect(getWalletFingerprint(WALLET_A, 8)).toHaveLength(8);
    expect(formatWalletFingerprint(WALLET_A)).toBe(
      `C-Pay wallet #${getWalletFingerprint(WALLET_A).toUpperCase()}`
    );
  });

  test('different wallets normally have different display fingerprints', () => {
    expect(getWalletFingerprint(WALLET_A)).not.toBe(getWalletFingerprint(WALLET_B));
  });
});

describe('isValidCPayId', () => {
  test('accepts both existing IDs and the new 64-bit random suffix format', () => {
    expect(isValidCPayId('alice@cpayk8f3qz')).toBe(true);
    expect(isValidCPayId('alice@cpay1234567890abcdef')).toBe(true);
    expect(isValidCPayId('first.last@cpay1234567890abcdef')).toBe(true);
    // Random, non-identifying handles assigned by the database (#161).
    expect(isValidCPayId('user3f9a0c@cpay1234567890abcdef')).toBe(true);
  });

  test('rejects malformed IDs and suffixes longer than 32 characters', () => {
    expect(isValidCPayId('alice@gmail.com')).toBe(false);
    expect(isValidCPayId('ab@cpayk8f3qz')).toBe(false);
    expect(isValidCPayId(`alice@cpay${'a'.repeat(33)}`)).toBe(false);
    expect(isValidCPayId('')).toBe(false);
    expect(isValidCPayId(WALLET_A)).toBe(false);
  });
});

describe('extractLast4FromCPayId', () => {
  test('extracts existing and new random suffixes', () => {
    expect(extractLast4FromCPayId('alice@cpayk8f3qz')).toBe('k8f3qz');
    expect(extractLast4FromCPayId('alice@cpay1234567890abcdef')).toBe('1234567890abcdef');
  });

  test('returns null for non-C-Pay IDs', () => {
    expect(extractLast4FromCPayId('alice@gmail.com')).toBeNull();
    expect(extractLast4FromCPayId('')).toBeNull();
  });
});

describe('getCurrentUserCPayId', () => {
  test('returns and caches only the ID persisted for the wallet', async () => {
    const persistedId = 'alice@cpay1234567890abcdef';
    const query = resetUserQuery();
    query.single.mockResolvedValue({ data: { cpay_id: persistedId }, error: null });
    await AsyncStorage.setItem('wallet_address', WALLET_A);

    await expect(getCurrentUserCPayId()).resolves.toBe(persistedId);
    await expect(AsyncStorage.getItem('cpay_id')).resolves.toBe(persistedId);
  });

  test('clears a stale cached ID when the database has no profile', async () => {
    await AsyncStorage.setItem('wallet_address', WALLET_A);
    await AsyncStorage.setItem('cpay_id', 'stale@cpay000000');

    await expect(getCurrentUserCPayId()).resolves.toBeNull();
    await expect(AsyncStorage.getItem('cpay_id')).resolves.toBeNull();
  });

  test('does not return a cached ID when the database lookup fails', async () => {
    const query = resetUserQuery();
    query.single.mockResolvedValue({
      data: null,
      error: { code: 'NETWORK_ERROR', message: 'offline' },
    });
    await AsyncStorage.setItem('wallet_address', WALLET_A);
    await AsyncStorage.setItem('cpay_id', 'stale@cpay000000');

    await expect(getCurrentUserCPayId()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(AsyncStorage.getItem('cpay_id')).resolves.toBeNull();
  });
});
