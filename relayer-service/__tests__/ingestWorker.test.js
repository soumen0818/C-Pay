'use strict';

const { IngestWorker, BoundedLruMap, SupabaseRequestError, DEFAULT_CURSOR_KEY } = require('../ingestWorker');

function makeResponse(ok, status, data) {
  const body = JSON.stringify(data);
  return {
    ok,
    status,
    text: async () => body,
    json: async () => data,
  };
}

describe('IngestWorker', () => {
  const MOCK_SUPABASE_URL = 'https://mock.supabase.co';
  const MOCK_SERVICE_ROLE_KEY = 'mock-service-role-key';
  const MOCK_HORIZON_URL = 'https://horizon-testnet.stellar.org';

  let requests = [];
  let mockFetch;
  let mockWalletBindings = [];

  beforeEach(() => {
    requests = [];
    mockWalletBindings = [];
    mockFetch = jest.fn(async (url, options = {}) => {
      const urlStr = String(url);
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url: urlStr, method, headers: options.headers, body });

      // Cursor loading
      if (urlStr.includes('/rest/v1/ingest_state')) {
        if (method === 'GET') {
          return makeResponse(true, 200, [{ key: DEFAULT_CURSOR_KEY, cursor: '12345-0', last_ledger: 100 }]);
        }
        return makeResponse(true, 200, { success: true });
      }

      // Wallet bindings
      if (urlStr.includes('/rest/v1/wallet_bindings')) {
        if (urlStr.includes('wallet_address=eq.')) {
          const match = urlStr.match(/wallet_address=eq\.([^&]+)/);
          const addr = match ? decodeURIComponent(match[1]) : null;
          const found = mockWalletBindings.find(b => b.wallet_address === addr && b.is_active !== false);
          if (found) {
            return makeResponse(true, 200, [{ auth_user_id: found.auth_user_id }]);
          }
          return makeResponse(true, 200, []);
        }
        return makeResponse(true, 200, mockWalletBindings);
      }

      // Wallet cache
      if (urlStr.includes('/rest/v1/users')) {
        if (urlStr.includes('wallet_address=eq.')) {
          const match = urlStr.match(/wallet_address=eq\.([^&]+)/);
          const addr = match ? decodeURIComponent(match[1]) : null;
          if (addr === 'GAKNOWN_WALLET_1') return makeResponse(true, 200, [{ id: 'user-1-uid' }]);
          if (addr === 'GAKNOWN_WALLET_2') return makeResponse(true, 200, [{ id: 'user-2-uid' }]);
          return makeResponse(true, 200, []);
        }
        return makeResponse(true, 200, [
          { id: 'user-1-uid', wallet_address: 'GAKNOWN_WALLET_1' },
          { id: 'user-2-uid', wallet_address: 'GAKNOWN_WALLET_2' },
        ]);
      }

      // Transactions
      if (urlStr.includes('/rest/v1/transactions')) {
        if (method === 'GET') {
          return makeResponse(true, 200, [
            { id: 'pending-tx-1', tx_hash: 'tx-hash-pending-1', submitted_at: '2026-08-28T00:00:00Z' },
          ]);
        }
        return makeResponse(true, 200, { success: true });
      }

      return makeResponse(true, 200, []);
    });
  });

  test('initializes and recovers cursor from Supabase storage', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.initCursor();
    expect(worker.lastCursor).toBe('12345-0');
    expect(worker.lastIngestedLedger).toBe(100);
  });

  test('refreshes and caches known user wallets', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();
    expect(worker.walletUserCache.get('GAKNOWN_WALLET_1')).toBe('user-1-uid');
    expect(worker.walletUserCache.get('GAKNOWN_WALLET_2')).toBe('user-2-uid');
    expect(worker.walletUserCache.get('GAUNKNOWN_WALLET')).toBeUndefined();
  });

  test('processes payment operation and upserts transaction with matched user ID', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();

    const paymentOp = {
      id: 'op-101',
      type: 'payment',
      paging_token: '429496729600-1',
      transaction_hash: 'cpay-test-tx-hash-1',
      from: 'GAKNOWN_WALLET_1',
      to: 'GAUNKNOWN_WALLET',
      amount: '50.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: 'GCISSUER123',
      created_at: '2026-08-28T12:00:00Z',
    };

    await worker.processOperation(paymentOp);

    expect(worker.processedCount).toBe(1);
    expect(worker.lastCursor).toBe('429496729600-1');

    const txUpsertReq = requests.find(r => r.url.includes('/rest/v1/transactions') && r.method === 'POST');
    expect(txUpsertReq).toBeDefined();
    expect(txUpsertReq.body).toMatchObject({
      tx_hash: 'cpay-test-tx-hash-1',
      op_index: 1,
      transaction_type: 'personal',
      from_address: 'GAKNOWN_WALLET_1',
      to_address: 'GAUNKNOWN_WALLET',
      amount: '50.0000000',
      asset_code: 'USDC',
      asset_issuer: 'GCISSUER123',
      status: 'success',
      internal_status: 'confirmed',
      user_id: 'user-1-uid',
    });
  });

  test('does not ingest payment when neither party is a known account', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();

    // TOID layout: 32 bits ledger | 20 bits tx order | 12 bits op index
    // ledger 100, tx 0, op 101 => (100n << 32n) | 101n = 429496729701
    const unknownOpToken = ((100n << 32n) | 101n).toString();
    const paymentOp = {
      id: 'op-102',
      type: 'payment',
      paging_token: unknownOpToken,
      transaction_hash: 'cpay-test-tx-hash-unknown',
      from: 'GASTRANGER_1',
      to: 'GASTRANGER_2',
      amount: '10.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      created_at: '2026-08-28T12:05:00Z',
    };

    await worker.processOperation(paymentOp);

    // No row upserted
    const txUpsertReq = requests.find(r => r.url.includes('/rest/v1/transactions') && r.body?.tx_hash === 'cpay-test-tx-hash-unknown');
    expect(txUpsertReq).toBeUndefined();
    // But cursor and ledger sequence still advance
    expect(worker.lastCursor).toBe(unknownOpToken);
    expect(worker.lastIngestedLedger).toBe(100);
  });

  test('a transaction with two payment operations produces two rows with distinct op_index', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();

    // TOID layout: 32 bits ledger | 20 bits tx order | 12 bits op index
    // ledger 500, tx 1, op 1 => (500n << 32n) | (1n << 12n) | 1n = 2147483652097
    // ledger 500, tx 1, op 2 => (500n << 32n) | (1n << 12n) | 2n = 2147483652098
    const tokenOp1 = ((500n << 32n) | (1n << 12n) | 1n).toString();
    const tokenOp2 = ((500n << 32n) | (1n << 12n) | 2n).toString();

    const op1 = {
      id: tokenOp1,
      type: 'payment',
      paging_token: tokenOp1,
      transaction_hash: 'multi-op-tx-hash',
      from: 'GAKNOWN_WALLET_1',
      to: 'GASTRANGER_A',
      amount: '15.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      created_at: '2026-08-28T12:10:00Z',
    };

    const op2 = {
      id: tokenOp2,
      type: 'payment',
      paging_token: tokenOp2,
      transaction_hash: 'multi-op-tx-hash',
      from: 'GAKNOWN_WALLET_1',
      to: 'GASTRANGER_B',
      amount: '25.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      created_at: '2026-08-28T12:10:00Z',
    };

    await worker.processOperation(op1);
    await worker.processOperation(op2);

    const txUpserts = requests.filter(r => r.url.includes('/rest/v1/transactions') && r.method === 'POST');
    expect(txUpserts).toHaveLength(2);
    expect(txUpserts[0].body.tx_hash).toBe('multi-op-tx-hash');
    expect(txUpserts[0].body.op_index).toBe(1);
    expect(txUpserts[1].body.tx_hash).toBe('multi-op-tx-hash');
    expect(txUpserts[1].body.op_index).toBe(2);
    expect(txUpserts[0].body.op_index).not.toBe(txUpserts[1].body.op_index);
  });

  test('reported ingest lag matches actual ledger lag, verified against a real Horizon testnet paging token', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();

    // Real Horizon testnet paging token:
    // Ledger 5884712, tx order 19, op index 1
    // TOID: (5884712n << 32n) | (19n << 12n) | 1n = 25274645586456577
    const realHorizonToken = '25274645586456577';
    const expectedLedger = 5884712;

    expect(worker.extractLedgerSequence({ paging_token: realHorizonToken })).toBe(expectedLedger);
    expect(worker.extractOpIndex({ paging_token: realHorizonToken })).toBe(1);

    const paymentOp = {
      id: realHorizonToken,
      type: 'payment',
      paging_token: realHorizonToken,
      transaction_hash: 'c71055f109cd74ce054e9b793d0d97c601ddcb38ff9d30904edbe0a7a08f40c8',
      from: 'GAKNOWN_WALLET_1',
      to: 'GAUNKNOWN_WALLET',
      amount: '10.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      created_at: '2026-08-28T12:00:00Z',
    };

    await worker.processOperation(paymentOp);

    expect(worker.lastIngestedLedger).toBe(expectedLedger);

    worker.latestNetworkLedger = expectedLedger + 20;
    worker.status = 'running';

    const lag = worker.getLag();
    expect(lag.lastIngestedLedger).toBe(expectedLedger);
    expect(lag.latestNetworkLedger).toBe(expectedLedger + 20);
    expect(lag.ledgerLag).toBe(20);

    const health = worker.getHealth();
    expect(health.lag).toBe(20);
    expect(health.healthy).toBe(true);
  });

  test('extractLedgerSequence correctly handles real Horizon tokens and field preferences', () => {
    const worker = new IngestWorker();

    // Real Horizon testnet paging tokens
    // Operation 25274645586456577: ledger 5884712, tx order 19, op index 1
    expect(worker.extractLedgerSequence({ paging_token: '25274645586456577' })).toBe(5884712);
    // Operation 25274684241104901: ledger 5884721, tx order 5, op index 5
    expect(worker.extractLedgerSequence({ paging_token: '25274684241104901' })).toBe(5884721);
    // Operation id used as fallback if paging_token absent
    expect(worker.extractLedgerSequence({ id: '25274645586456577' })).toBe(5884712);
    // Paging token with hyphen suffix
    expect(worker.extractLedgerSequence({ paging_token: '25274645586456577-1' })).toBe(5884712);

    // Field preference: transaction_attr.ledger takes highest precedence
    expect(
      worker.extractLedgerSequence({
        transaction_attr: { ledger: 9000001 },
        ledger: 8000001,
        paging_token: '25274645586456577',
      })
    ).toBe(9000001);

    // Field preference: ledger field preferred over paging_token when transaction_attr is absent
    expect(
      worker.extractLedgerSequence({
        ledger: 8000001,
        paging_token: '25274645586456577',
      })
    ).toBe(8000001);

    // Null/empty/invalid handling
    expect(worker.extractLedgerSequence(null)).toBeNull();
    expect(worker.extractLedgerSequence({})).toBeNull();
    expect(worker.extractLedgerSequence({ paging_token: 'invalid_token' })).toBeNull();
  });

  test('replaying a ledger range produces no duplicate records via on_conflict idempotency', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();

    // TOID layout: (100n << 32n) | (1n << 12n) | 1n = 429496733697
    const token = ((100n << 32n) | (1n << 12n) | 1n).toString();
    const paymentOp = {
      id: token,
      type: 'payment',
      paging_token: token,
      transaction_hash: 'replay-test-tx-hash',
      from: 'GAKNOWN_WALLET_1',
      to: 'GAUNKNOWN_WALLET',
      amount: '50.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      created_at: '2026-08-28T12:00:00Z',
    };

    // First ingestion
    await worker.processOperation(paymentOp);
    // Replay same operation
    await worker.processOperation(paymentOp);

    const txUpserts = requests.filter(r => r.url.includes('/rest/v1/transactions') && r.method === 'POST');
    expect(txUpserts).toHaveLength(2);
    for (const req of txUpserts) {
      expect(req.url).toContain('on_conflict=tx_hash,op_index');
      expect(req.headers['Prefer']).toContain('resolution=merge-duplicates');
      expect(req.body.tx_hash).toBe('replay-test-tx-hash');
      expect(req.body.op_index).toBe(1);
    }
  });

  test('ignores foreign assets and non-payment operations without writing rows', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
      assetCode: 'CPINR',
    });

    await worker.refreshWalletCache();

    // Native XLM payment
    await worker.processOperation({
      id: 'op-foreign-1',
      type: 'payment',
      paging_token: '100',
      transaction_hash: 'tx-foreign-1',
      from: 'GAKNOWN_WALLET_1',
      to: 'GAUNKNOWN_WALLET',
      amount: '10.0000000',
      asset_type: 'native',
    });

    // create_account
    await worker.processOperation({
      id: 'op-create-1',
      type: 'create_account',
      paging_token: '101',
      transaction_hash: 'tx-create-1',
      funder: 'GAKNOWN_WALLET_1',
      account: 'GAUNKNOWN_WALLET',
      starting_balance: '10.0000000',
    });

    // path payment
    await worker.processOperation({
      id: 'op-path-1',
      type: 'path_payment_strict_send',
      paging_token: '102',
      transaction_hash: 'tx-path-1',
      from: 'GAKNOWN_WALLET_1',
      to: 'GAUNKNOWN_WALLET',
      amount: '10.0000000',
      asset_code: 'USDC',
    });

    const txUpserts = requests.filter(r => r.url.includes('/rest/v1/transactions') && r.method === 'POST');
    expect(txUpserts).toHaveLength(0);
  });

  test('calculates lag metrics accurately', () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
    });

    worker.lastIngestedLedger = 1000;
    worker.latestNetworkLedger = 1005;
    worker.status = 'running';

    const lag = worker.getLag();
    expect(lag.ledgerLag).toBe(5);
    expect(lag.lastIngestedLedger).toBe(1000);
    expect(lag.latestNetworkLedger).toBe(1005);

    const health = worker.getHealth();
    expect(health.healthy).toBe(true);
    expect(health.lag).toBe(5);
  });

  test('reconciles pending transaction to success when confirmed on Horizon', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    // Mock server.transactions().transaction()
    worker.server.transactions = () => ({
      transaction: (hash) => ({
        call: async () => ({
          id: hash,
          successful: true,
          created_at: '2026-08-28T00:01:00Z',
        }),
      }),
    });

    await worker.reconcilePendingTransactions();

    const patchReq = requests.find(r => r.url.includes('/rest/v1/transactions?id=eq.pending-tx-1') && r.method === 'PATCH');
    expect(patchReq).toBeDefined();
    expect(patchReq.body.status).toBe('success');
    expect(patchReq.body.internal_status).toBe('confirmed');
    expect(worker.reconciledCount).toBe(1);
  });

  test('reconciles timed-out transaction to failed when 404 on Horizon', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    worker.server.transactions = () => ({
      transaction: () => ({
        call: async () => {
          const err = new Error('Not Found');
          err.response = { status: 404 };
          throw err;
        },
      }),
    });

    await worker.reconcilePendingTransactions();

    const patchReq = requests.find(r => r.url.includes('/rest/v1/transactions?id=eq.pending-tx-1') && r.method === 'PATCH');
    expect(patchReq).toBeDefined();
    expect(patchReq.body.status).toBe('failed');
    expect(patchReq.body.internal_status).toBe('failed');
    expect(patchReq.body.failure_reason).toContain('not found on chain');
  });

  test('supabaseRequest throws typed SupabaseRequestError on PostgREST error', async () => {
    const postgrestBody = {
      code: '23505',
      details: 'Key (id)=(1) already exists.',
      hint: null,
      message: 'duplicate key value violates unique constraint',
    };
    const failFetch = jest.fn(async () => makeResponse(false, 409, postgrestBody));
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: failFetch,
    });

    await expect(worker.supabaseRequest('transactions', { method: 'POST' })).rejects.toMatchObject({
      name: 'SupabaseRequestError',
      status: 409,
      code: '23505',
      details: 'Key (id)=(1) already exists.',
      hint: null,
      message: 'Supabase request failed with status 409',
    });
  });

  test('reconcilePendingTransactions does not treat a Supabase error as Horizon 404', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    // Horizon succeeds
    worker.server.transactions = () => ({
      transaction: (hash) => ({
        call: async () => ({
          id: hash,
          successful: true,
          created_at: '2026-08-28T00:01:00Z',
        }),
      }),
    });

    // Supabase PATCH throws SupabaseRequestError
    const originalRequest = worker.supabaseRequest.bind(worker);
    worker.supabaseRequest = async (path, options = {}) => {
      if (options.method === 'PATCH') {
        throw new SupabaseRequestError({
          status: 404,
          code: 'PGRST116',
          details: 'The result contains 0 rows',
          message: 'JSON object requested, multiple (or no) rows returned',
        });
      }
      return originalRequest(path, options);
    };

    const initialReconciled = worker.reconciledCount;
    await worker.reconcilePendingTransactions();
    // Reconciled count does not increment because Supabase update failed
    expect(worker.reconciledCount).toBe(initialReconciled);
  });

  test('BoundedLruMap bounds capacity and evicts least recently used items', () => {
    const lru = new BoundedLruMap(2);
    lru.set('addr1', 'u1');
    lru.set('addr2', 'u2');
    expect(lru.size).toBe(2);
    expect(lru.get('addr1')).toBe('u1'); // Promote addr1
    lru.set('addr3', 'u3'); // Should evict addr2
    expect(lru.size).toBe(2);
    expect(lru.get('addr2')).toBeUndefined();
    expect(lru.get('addr1')).toBe('u1');
    expect(lru.get('addr3')).toBe('u3');
  });

  test('resolves un-cached wallet address on demand via getUserIdForWallet', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    const userId = await worker.getUserIdForWallet('GAKNOWN_WALLET_1');
    expect(userId).toBe('user-1-uid');
    expect(worker.walletUserCache.get('GAKNOWN_WALLET_1')).toBe('user-1-uid');
  });

  test('enforces active-standby leader election across worker instances', async () => {
    let leaseStore = [];
    const leaderFetch = jest.fn(async (url, options = {}) => {
      const urlStr = String(url);
      const method = options.method || 'GET';
      if (urlStr.includes('/rest/v1/ingest_state')) {
        if (method === 'GET') {
          return makeResponse(true, 200, leaseStore);
        }
        if (method === 'POST') {
          const body = JSON.parse(options.body);
          leaseStore = [{ ...body }];
          return makeResponse(true, 200, leaseStore);
        }
        if (method === 'DELETE') {
          leaseStore = [];
          return makeResponse(true, 200, []);
        }
      }
      return makeResponse(true, 200, []);
    });

    const worker1 = new IngestWorker({
      workerId: 'worker-instance-1',
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: leaderFetch,
      leaderLeaseTtlMs: 30000,
    });

    const worker2 = new IngestWorker({
      workerId: 'worker-instance-2',
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: leaderFetch,
      leaderLeaseTtlMs: 30000,
    });

    // worker1 claims leadership
    const isLeader1 = await worker1.acquireOrRenewLeaderLease();
    expect(isLeader1).toBe(true);
    expect(worker1.isLeader).toBe(true);

    // worker2 attempts to acquire, sees active lease from worker1 -> standby
    const isLeader2 = await worker2.acquireOrRenewLeaderLease();
    expect(isLeader2).toBe(false);
    expect(worker2.isLeader).toBe(false);

    // worker1 stops and releases lease
    await worker1.stop();
    expect(worker1.isLeader).toBe(false);

    // worker2 can now acquire leadership
    const isLeader2After = await worker2.acquireOrRenewLeaderLease();
    expect(isLeader2After).toBe(true);
    expect(worker2.isLeader).toBe(true);
  });

  test('wallet bound after start is ingested on its next payment', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    // Start with initial cache (GANEW_USER_WALLET is not known yet)
    await worker.initCursor();
    await worker.refreshWalletCache();
    expect(worker.walletUserCache.get('GANEW_USER_WALLET')).toBeUndefined();

    // User binds a new wallet to wallet_bindings
    mockWalletBindings.push({
      auth_user_id: 'user-new-uid',
      wallet_address: 'GANEW_USER_WALLET',
      is_active: true,
    });

    // Payment arrives for the newly bound wallet
    const paymentOp = {
      id: 'op-bound-after-start',
      type: 'payment',
      paging_token: '999999999-1',
      transaction_hash: 'tx-new-bound-wallet',
      from: 'GANEW_USER_WALLET',
      to: 'GASTRANGER_XYZ',
      amount: '75.0000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      created_at: '2026-08-28T14:00:00Z',
    };

    await worker.processOperation(paymentOp);

    expect(worker.processedCount).toBe(1);
    const txUpsertReq = requests.find(r => r.url.includes('/rest/v1/transactions') && r.body?.tx_hash === 'tx-new-bound-wallet');
    expect(txUpsertReq).toBeDefined();
    expect(txUpsertReq.body.user_id).toBe('user-new-uid');
    expect(worker.walletUserCache.get('GANEW_USER_WALLET')).toBe('user-new-uid');
  });

  test('backfill newly bound wallet fetches payments for account from Horizon without mutating lastCursor', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.initCursor();
    expect(worker.lastCursor).toBe('12345-0');

    // Mock Horizon payments for the account
    const historicalOps = [
      {
        id: 'hist-op-1',
        type: 'payment',
        paging_token: '1000-1',
        transaction_hash: 'tx-hist-1',
        from: 'GA_EXTERNAL_SENDER',
        to: 'GANEWLY_BOUND_ACCOUNT',
        amount: '20.0000000',
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        created_at: '2026-08-27T10:00:00Z',
      },
      {
        id: 'hist-op-2',
        type: 'payment',
        paging_token: '1000-2',
        transaction_hash: 'tx-hist-2',
        from: 'GANEWLY_BOUND_ACCOUNT',
        to: 'GA_EXTERNAL_RECEIVER',
        amount: '10.0000000',
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        created_at: '2026-08-27T11:00:00Z',
      },
    ];

    worker.server.payments = () => ({
      forAccount: (account) => ({
        order: () => ({
          limit: () => ({
            call: async () => ({ records: historicalOps }),
          }),
        }),
      }),
    });

    const result = await worker.backfillWallet('GANEWLY_BOUND_ACCOUNT', 'user-backfill-uid');
    expect(result.processed).toBe(2);

    // Global cursor must NOT have been changed by backfilling
    expect(worker.lastCursor).toBe('12345-0');

    // Both historical transactions upserted to Supabase
    const upsertedHist1 = requests.find(r => r.url.includes('/rest/v1/transactions') && r.body?.tx_hash === 'tx-hist-1');
    const upsertedHist2 = requests.find(r => r.url.includes('/rest/v1/transactions') && r.body?.tx_hash === 'tx-hist-2');
    expect(upsertedHist1).toBeDefined();
    expect(upsertedHist1.body.user_id).toBe('user-backfill-uid');
    expect(upsertedHist2).toBeDefined();
    expect(upsertedHist2.body.user_id).toBe('user-backfill-uid');
  });

  test('pollOnce refreshes wallet cache before processing batch', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.initCursor();
    // Initially cache from users
    await worker.refreshWalletCache();

    // Now wallet_bindings has a new binding
    mockWalletBindings.push({
      auth_user_id: 'user-batch-uid',
      wallet_address: 'GABATCH_WALLET',
      is_active: true,
    });

    const mockBuilder = {
      cursor: jest.fn().mockReturnThis(),
      call: async () => ({
        records: [
          {
            id: 'batch-op-1',
            type: 'payment',
            paging_token: '88888-1',
            transaction_hash: 'tx-batch-1',
            from: 'GABATCH_WALLET',
            to: 'GASTRANGER',
            amount: '30.0000000',
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            created_at: '2026-08-28T15:00:00Z',
          },
        ],
      }),
    };

    worker.server.payments = () => ({
      order: () => ({
        limit: () => mockBuilder,
      }),
    });

    worker.server.ledgers = () => ({
      order: () => ({
        limit: () => ({
          call: async () => ({ records: [{ sequence: 200 }] }),
        }),
      }),
    });

    await worker.pollOnce();

    expect(worker.walletUserCache.get('GABATCH_WALLET')).toBe('user-batch-uid');
    const upserted = requests.find(r => r.url.includes('/rest/v1/transactions') && r.body?.tx_hash === 'tx-batch-1');
    expect(upserted).toBeDefined();
    expect(upserted.body.user_id).toBe('user-batch-uid');
  });

  test('wallet refresh timer starts and stops cleanly', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
      walletRefreshIntervalMs: 1000,
    });

    worker.startWalletRefreshTimer();
    expect(worker.walletRefreshTimer).not.toBeNull();

    worker.stopStreamingOrPolling();
    expect(worker.walletRefreshTimer).toBeNull();
  });
});

