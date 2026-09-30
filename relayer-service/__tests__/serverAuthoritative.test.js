'use strict';

const { IngestWorker, DEFAULT_CURSOR_KEY } = require('../ingestWorker');

function makeResponse(ok, status, data) {
  const body = JSON.stringify(data);
  return {
    ok,
    status,
    text: async () => body,
    json: async () => data,
  };
}

describe('Server-Authoritative Transactions (#10)', () => {
  const MOCK_SUPABASE_URL = 'https://mock.supabase.co';
  const MOCK_SERVICE_ROLE_KEY = 'mock-service-role-key';
  const MOCK_ANON_KEY = 'mock-anon-key';

  let requests = [];
  let mockFetch;

  beforeEach(() => {
    requests = [];
    mockFetch = jest.fn(async (url, options = {}) => {
      const urlStr = String(url);
      const method = options.method || 'GET';
      const headers = options.headers || {};
      const body = options.body ? JSON.parse(options.body) : null;
      requests.push({ url: urlStr, method, headers, body });

      // Simulate RLS rejection for client writes (non-service role header)
      if (urlStr.includes('/rest/v1/transactions') && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
        const authHeader = headers['Authorization'] || headers['authorization'] || '';
        const apiKey = headers['apikey'] || '';
        const isServiceRole = apiKey === MOCK_SERVICE_ROLE_KEY || authHeader.includes(MOCK_SERVICE_ROLE_KEY);
        
        if (!isServiceRole) {
          return makeResponse(false, 403, {
            code: '42501',
            message: 'new row violates row-level security policy for table "transactions"',
          });
        }
        return makeResponse(true, 200, [{ id: 'tx-1', status: 'success' }]);
      }

      // Cursor loading
      if (urlStr.includes('/rest/v1/ingest_state')) {
        return makeResponse(true, 200, [{ key: DEFAULT_CURSOR_KEY, cursor: '100', last_ledger: 50 }]);
      }

      // User cache
      if (urlStr.includes('/rest/v1/users')) {
        return makeResponse(true, 200, [
          { id: 'user-1', wallet_address: 'GCLERKPAYER' },
        ]);
      }

      return makeResponse(true, 200, []);
    });
  });

  test('rejects forged client transaction writes when non-service-role key is used', async () => {
    const doFetch = mockFetch;

    // Simulate mobile app client trying to directly insert forged transaction row with anon/authenticated key
    const clientResponse = await doFetch(`${MOCK_SUPABASE_URL}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        apikey: MOCK_ANON_KEY,
        Authorization: `Bearer ${MOCK_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tx_hash: 'forged-hash-999',
        to_address: 'GCRECEIVER_WALLET',
        amount: '1000000.00',
        status: 'success',
        transaction_type: 'personal',
      }),
    });

    expect(clientResponse.ok).toBe(false);
    expect(clientResponse.status).toBe(403);

    const errorBody = await clientResponse.json();
    expect(errorBody.code).toBe('42501');
  });

  test('permits trusted transaction writes when service-role key is used', async () => {
    const worker = new IngestWorker({
      supabaseUrl: MOCK_SUPABASE_URL,
      supabaseServiceRoleKey: MOCK_SERVICE_ROLE_KEY,
      fetch: mockFetch,
    });

    await worker.refreshWalletCache();

    const paymentOp = {
      id: 'op-301',
      type: 'payment',
      paging_token: '1000-1',
      transaction_hash: 'trusted-tx-hash-777',
      from: 'GCLERKPAYER',
      to: 'GCRECEIVER_WALLET',
      amount: '45.5000000',
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      created_at: '2026-08-29T10:00:00Z',
    };

    await worker.processOperation(paymentOp);

    const txUpsert = requests.find(r => r.url.includes('/rest/v1/transactions') && r.method === 'POST');
    expect(txUpsert).toBeDefined();
    expect(txUpsert.headers['apikey']).toBe(MOCK_SERVICE_ROLE_KEY);
    expect(txUpsert.body).toMatchObject({
      tx_hash: 'trusted-tx-hash-777',
      from_address: 'GCLERKPAYER',
      to_address: 'GCRECEIVER_WALLET',
      amount: '45.5000000',
      transaction_type: 'personal',
      status: 'success',
    });
  });
});
