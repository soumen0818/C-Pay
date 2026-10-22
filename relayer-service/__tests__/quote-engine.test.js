'use strict';

const { createQuoteEngine } = require('../quote-engine');

describe('remittance quote engine', () => {
  const now = 1_700_000_000_000;

  test('calculates fee, spread-adjusted FX, recipient amount, and expiry', async () => {
    const engine = createQuoteEngine({
      rateProvider: { getRate: async () => '90.12345678' },
      signingSecret: 'test-quote-signing-secret',
      feeBps: 175,
      spreadBps: 50,
      ttlSeconds: 60,
      now: () => now,
    });

    await expect(engine.createQuote({
      sendAmount: '100.00',
      sendCurrency: 'USD',
      receiveCurrency: 'INR',
    })).resolves.toMatchObject({
      sendAmount: '100.00',
      amountDebited: '101.75',
      fee: '1.75',
      feeBps: 175,
      spreadBps: 50,
      fxRate: 90.12345678,
      recipientAmount: '8967.28',
      receiveCurrency: 'INR',
      expiresAt: '2023-11-14T22:14:20.000Z',
    });
  });

  test('rejects expired quotes and requires a new quote', async () => {
    let clock = now;
    const engine = createQuoteEngine({
      rateProvider: { getRate: async () => 90 },
      signingSecret: 'test-quote-signing-secret',
      ttlSeconds: 10,
      now: () => clock,
    });
    const quote = await engine.createQuote({ sendAmount: '1', sendCurrency: 'USD', receiveCurrency: 'INR' });

    expect(engine.assertFresh(quote)).toBe(quote);
    clock += 10_001;
    expect(() => engine.assertFresh(quote)).toThrow('Quote has expired');
  });

  test('does not silently fall back when the provider has no rate', async () => {
    const engine = createQuoteEngine({
      rateProvider: { getRate: async () => { throw new Error('provider unavailable'); } },
      signingSecret: 'test-quote-signing-secret',
    });
    await expect(engine.createQuote({ sendAmount: '10', sendCurrency: 'USD', receiveCurrency: 'INR' }))
      .rejects.toThrow('provider unavailable');
  });
});
