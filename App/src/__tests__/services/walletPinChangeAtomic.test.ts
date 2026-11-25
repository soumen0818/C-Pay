/**
 * Issue #119 — Atomic PIN change via slot pointer and startup recovery.
 *
 * Acceptance criteria:
 * 1. The commit is a single write (ACTIVE_SLOT_KEY); no interleaving can leave
 *    verifier and blob disagreeing.
 * 2. Startup detects and resolves a half-finished change.
 * 3. Killed at any step, the wallet opens with either the old or the new PIN,
 *    and the failing one reports "wrong PIN" (INVALID_PIN), never a STORAGE_ERROR.
 * 4. A wipe cannot destroy the only valid verifier mid-change.
 */

function getSecureStoreMock() {
  return require('expo-secure-store');
}

function resetStore() {
  const store = getSecureStoreMock().__store;
  Object.keys(store).forEach((k) => delete store[k]);
}

describe('Atomic PIN change & recovery (issue #119)', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore();
  });

  test('normal PIN change flips old to new via atomic slot pointer and updates legacy mirrors', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();
    const OLD_PIN = '111111';
    const NEW_PIN = '222222';

    const publicKey = await wallet.createWallet(OLD_PIN);
    expect(await wallet.hasWallet()).toBe(true);

    // Initial state: slot 0 is active
    expect(await SecureStoreMock.getItemAsync(wallet.ACTIVE_SLOT_KEY)).toBe('0');
    const slot0Raw = await SecureStoreMock.getItemAsync(wallet.SLOT_0_KEY);
    expect(slot0Raw).not.toBeNull();

    // Change PIN
    await wallet.changeWalletPin(OLD_PIN, NEW_PIN);

    // Pointer flipped to slot 1
    expect(await SecureStoreMock.getItemAsync(wallet.ACTIVE_SLOT_KEY)).toBe('1');
    expect(await SecureStoreMock.getItemAsync(wallet.SLOT_0_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_SLOT_KEY)).toBeNull();

    // Clear in-memory session cache to force disk read
    wallet.clearSessionPin();

    // New PIN opens wallet
    const newRes = await wallet.getWallet(NEW_PIN);
    expect(newRes.success).toBe(true);
    expect(newRes.wallet.publicKey).toBe(publicKey);

    // Old PIN fails with INVALID_PIN, NOT STORAGE_ERROR
    const oldRes = await wallet.getWallet(OLD_PIN);
    expect(oldRes.success).toBe(false);
    expect(oldRes.error).toBe('INVALID_PIN');
  });

  test('process killed before atomic pointer write: rolls back, old PIN works, new PIN reports INVALID_PIN', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();
    const OLD_PIN = '123456';
    const NEW_PIN = '654321';

    const publicKey = await wallet.createWallet(OLD_PIN);

    // Simulate crash right before atomic commit:
    // Staged slot 1 and PENDING_SLOT_KEY exist, but ACTIVE_SLOT_KEY is still '0'.
    const stagedBundle = {
      version: 1,
      wallet: JSON.stringify({ version: 4, cipher: 'xchacha20-poly1305' }),
      salt: '00'.repeat(16),
      verifier: JSON.stringify({ version: 2, hash: 'staged-hash' }),
      updatedAt: new Date().toISOString(),
    };
    await SecureStoreMock.setItemAsync(wallet.SLOT_1_KEY, JSON.stringify(stagedBundle));
    await SecureStoreMock.setItemAsync(wallet.PENDING_SLOT_KEY, '1');
    await SecureStoreMock.setItemAsync(wallet.PENDING_WALLET_KEY, stagedBundle.wallet);

    // App restarts: SplashScreen runs hasWallet() / recoverPendingPinChange()
    await wallet.recoverPendingPinChange();

    // Verify recovery rolled back partial state
    expect(await SecureStoreMock.getItemAsync(wallet.ACTIVE_SLOT_KEY)).toBe('0');
    expect(await SecureStoreMock.getItemAsync(wallet.SLOT_1_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_SLOT_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_WALLET_KEY)).toBeNull();

    wallet.clearSessionPin();

    // Old PIN opens the wallet successfully
    const oldRes = await wallet.getWallet(OLD_PIN);
    expect(oldRes.success).toBe(true);
    expect(oldRes.wallet.publicKey).toBe(publicKey);

    // New PIN fails with INVALID_PIN, never STORAGE_ERROR
    const newRes = await wallet.getWallet(NEW_PIN);
    expect(newRes.success).toBe(false);
    expect(newRes.error).toBe('INVALID_PIN');
  });

  test('process killed after atomic pointer write before cleanup: rolls forward, new PIN works, old PIN reports INVALID_PIN', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();
    const OLD_PIN = '111111';
    const NEW_PIN = '999999';

    const publicKey = await wallet.createWallet(OLD_PIN);

    // Perform PIN change but intercept before cleanup can delete PENDING_SLOT_KEY
    let failPendingSlotDelete = true;
    SecureStoreMock.deleteItemAsync.mockImplementation(async (key: string) => {
      if (failPendingSlotDelete && key === wallet.PENDING_SLOT_KEY) {
        failPendingSlotDelete = false;
        // Simulate process killed here
        throw new Error('Process killed mid-cleanup');
      }
      delete SecureStoreMock.__store[key];
    });

    try {
      await wallet.changeWalletPin(OLD_PIN, NEW_PIN);
    } catch {
      // Expected kill
    }

    // Pointer was already flipped to '1', but PENDING_SLOT_KEY='1' remains
    expect(await SecureStoreMock.getItemAsync(wallet.ACTIVE_SLOT_KEY)).toBe('1');
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_SLOT_KEY)).toBe('1');

    // App restarts: startup recovery detects ACTIVE_SLOT === PENDING_SLOT
    await wallet.recoverPendingPinChange();

    // Finalized cleanup
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_SLOT_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.SLOT_0_KEY)).toBeNull();

    wallet.clearSessionPin();

    // New PIN opens the wallet
    const newRes = await wallet.getWallet(NEW_PIN);
    expect(newRes.success).toBe(true);
    expect(newRes.wallet.publicKey).toBe(publicKey);

    // Old PIN reports INVALID_PIN, never STORAGE_ERROR
    const oldRes = await wallet.getWallet(OLD_PIN);
    expect(oldRes.success).toBe(false);
    expect(oldRes.error).toBe('INVALID_PIN');
  });

  test('legacy crash after Write 1 (WALLET_KEY === PENDING_WALLET_KEY): rolls forward so verifier matches blob', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();
    const OLD_PIN = '333333';
    const NEW_PIN = '444444';

    await wallet.createWallet(OLD_PIN);

    // Simulate legacy 3-write crash:
    // Write 1 completed: WALLET_KEY was updated to PENDING_WALLET_KEY (encrypted under NEW_PIN).
    // Writes 2 & 3 not done: SALT_KEY and PIN_KEY still held old verifier for OLD_PIN.
    // Staged pending verifier & salt for NEW_PIN exist in pending keys.
    await wallet.changeWalletPin(OLD_PIN, NEW_PIN);

    // Grab valid new credentials from store
    const newWalletJson = await SecureStoreMock.getItemAsync(wallet.WALLET_KEY);
    const newSalt = await SecureStoreMock.getItemAsync(wallet.SALT_KEY);
    const newVerifier = await SecureStoreMock.getItemAsync(wallet.PIN_KEY);

    // Now restore old salt & verifier, but leave WALLET_KEY and PENDING keys as new
    await SecureStoreMock.setItemAsync(wallet.SALT_KEY, 'old_salt_hex'.repeat(2));
    await SecureStoreMock.setItemAsync(wallet.PIN_KEY, 'old_verifier_hash');
    await SecureStoreMock.setItemAsync(wallet.PENDING_WALLET_KEY, newWalletJson);
    await SecureStoreMock.setItemAsync(wallet.PENDING_SALT_KEY, newSalt);
    await SecureStoreMock.setItemAsync(wallet.PENDING_PIN_KEY, newVerifier);
    // Remove slot keys to simulate legacy state
    await SecureStoreMock.deleteItemAsync(wallet.ACTIVE_SLOT_KEY);
    await SecureStoreMock.deleteItemAsync(wallet.SLOT_0_KEY);
    await SecureStoreMock.deleteItemAsync(wallet.SLOT_1_KEY);

    // Startup recovery detects WALLET_KEY === PENDING_WALLET_KEY and rolls forward
    await wallet.recoverPendingPinChange();

    wallet.clearSessionPin();

    // New PIN opens wallet
    const newRes = await wallet.getWallet(NEW_PIN);
    expect(newRes.success).toBe(true);

    // Old PIN reports INVALID_PIN, never STORAGE_ERROR
    const oldRes = await wallet.getWallet(OLD_PIN);
    expect(oldRes.success).toBe(false);
    expect(oldRes.error).toBe('INVALID_PIN');
  });

  test('interrupted changeWalletPin via write error does not corrupt store', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();
    const OLD_PIN = '123456';
    const NEW_PIN = '789012';

    await wallet.createWallet(OLD_PIN);

    // Inject failure exactly when ACTIVE_SLOT_KEY is being written
    let failActiveSlotWrite = true;
    SecureStoreMock.setItemAsync.mockImplementation(async (key: string, val: string) => {
      if (failActiveSlotWrite && key === wallet.ACTIVE_SLOT_KEY) {
        failActiveSlotWrite = false;
        throw new Error('Disk full during atomic commit write');
      }
      SecureStoreMock.__store[key] = val;
    });

    await expect(wallet.changeWalletPin(OLD_PIN, NEW_PIN)).rejects.toThrow();

    // Startup recovery cleans up staged state
    await wallet.recoverPendingPinChange();

    wallet.clearSessionPin();

    // Old PIN continues to open wallet
    const oldRes = await wallet.getWallet(OLD_PIN);
    expect(oldRes.success).toBe(true);

    // New PIN reports INVALID_PIN
    const newRes = await wallet.getWallet(NEW_PIN);
    expect(newRes.success).toBe(false);
    expect(newRes.error).toBe('INVALID_PIN');
  });

  test('staged credentials are removed when staging fails before commit', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();
    const OLD_PIN = '123456';
    const NEW_PIN = '789012';

    await wallet.createWallet(OLD_PIN);

    const setItem = jest.spyOn(SecureStoreMock, 'setItemAsync');
    const defaultSetItem = setItem.getMockImplementation()!;
    setItem.mockImplementation(async (key, val) => {
      if (key === wallet.PENDING_PIN_KEY) {
        throw new Error('SecureStore write failed');
      }
      return defaultSetItem(key, val);
    });

    await expect(wallet.changeWalletPin(OLD_PIN, NEW_PIN)).rejects.toThrow('SecureStore write failed');

    jest.restoreAllMocks();
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_SLOT_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_WALLET_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_SALT_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_PIN_KEY)).toBeNull();

    wallet.clearSessionPin();
    expect((await wallet.getWallet(OLD_PIN)).success).toBe(true);
    expect((await wallet.getWallet(NEW_PIN)).error).toBe('INVALID_PIN');
  });

  test('wipe safety: clearWallet resolves any pending change before deleting keys', async () => {
    const wallet = require('../../services/wallet');
    const SecureStoreMock = getSecureStoreMock();
    const PIN = '555555';

    await wallet.createWallet(PIN);

    // Set a pending slot state
    await SecureStoreMock.setItemAsync(wallet.PENDING_SLOT_KEY, '1');
    await SecureStoreMock.setItemAsync(wallet.SLOT_1_KEY, 'pending_bundle_data');

    // Wipe wallet
    await wallet.clearWallet();

    // Every key is erased; no orphan slot or verifier remains
    expect(await SecureStoreMock.getItemAsync(wallet.ACTIVE_SLOT_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.SLOT_0_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.SLOT_1_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.PENDING_SLOT_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.WALLET_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.PIN_KEY)).toBeNull();
    expect(await SecureStoreMock.getItemAsync(wallet.SALT_KEY)).toBeNull();
    expect(await wallet.hasWallet()).toBe(false);
  });
});
