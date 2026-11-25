'use strict';

const createApp = require('../app');

describe('Stateless relayer', () => {
  test('two app instances share state only via the DB fake', async () => {
    // Shared in-memory DB fake
    const dbStore = {
      relayer_idempotency_keys: new Map(),
      payment_records: [],
    };

    const createFakeSupabase = () => ({
      async request(path, options = {}) {
        const method = options.method || 'GET';
        if (path === 'relayer_idempotency_keys') {
          if (method === 'POST') {
            const body = JSON.parse(options.body);
            if (dbStore.relayer_idempotency_keys.has(body.key)) {
              const err = new Error('duplicate key');
              err.status = 409;
              err.code = '23505';
              throw err;
            }
            dbStore.relayer_idempotency_keys.set(body.key, body);
            return [];
          }
        }
        if (path.startsWith('relayer_idempotency_keys')) {
          const parsed = new URL(`https://fake.supabase.co/${path}`);
          const key = (parsed.searchParams.get('key') || '').replace(/^eq\./, '');
          if (method === 'GET') {
            const entry = dbStore.relayer_idempotency_keys.get(key);
            return entry ? [entry] : [];
          }
          if (method === 'DELETE') {
            dbStore.relayer_idempotency_keys.delete(key);
            return [];
          }
        }
        if (path.startsWith('payment_records')) {
          if (method === 'POST') {
            const body = JSON.parse(options.body);
            dbStore.payment_records.push(body);
            return [body];
          }
          if (method === 'GET') {
            return dbStore.payment_records;
          }
        }
        return [];
      },
    });

    const config = {
      supabaseUrl: 'https://fake.supabase.co',
      supabaseServiceRoleKey: 'fake-service-role-key',
      relayerAuthRequired: false,
      dailyPaymentCapUsdc: 1000,
      singlePaymentCapUsdc: 500,
      lowBalanceAlertWindowMs: 60000,
    };

    // Instantiate two distinct app instances with their own memory spaces
    const app1 = createApp({ config, supabase: createFakeSupabase() });
    const app2 = createApp({ config, supabase: createFakeSupabase() });

    // 1. Idempotency lock acquired by instance 1 is seen by instance 2 through the shared DB
    const lock1 = await app1.testHooks.acquireIdempotencyLock('stateless-idem-key', 60000);
    expect(lock1.acquired).toBe(true);

    const lock2 = await app2.testHooks.acquireIdempotencyLock('stateless-idem-key', 60000);
    expect(lock2.acquired).toBe(false);

    // 2. Low-balance alert triggered on instance 1 coordinates across instances via DB
    const shouldAlertInst1 = await app1.testHooks.shouldSendLowBalanceAlert('sponsor_balance');
    expect(shouldAlertInst1).toBe(true);

    const shouldAlertInst2 = await app2.testHooks.shouldSendLowBalanceAlert('sponsor_balance');
    expect(shouldAlertInst2).toBe(false);

    // 3. Resetting on instance 1 clears the alert in DB, allowing instance 2 to alert
    await app1.testHooks.resetLowBalanceAlert('sponsor_balance');
    const shouldAlertInst2AfterReset = await app2.testHooks.shouldSendLowBalanceAlert('sponsor_balance');
    expect(shouldAlertInst2AfterReset).toBe(true);

    // 4. Payment record written by instance 1 is visible to instance 2 only via the DB
    await app1.testHooks.recordPaymentRecord({
      authUserId: 'user-stateless-1',
      walletAddress: 'GDUXXBTQHTSNMHFKO2BNUQNQUCVIOKEMMKD5AWIFYBKOAVMFHBUP3RYJ',
      amount: '75.00',
    });

    const recordsFromApp2 = await app2.testHooks.supabaseRestRequest('payment_records', { method: 'GET' });
    expect(recordsFromApp2).toHaveLength(1);
    expect(recordsFromApp2[0].amount).toBe('75.00');
  });
});
