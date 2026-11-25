'use strict';

const { createQuoteEngine } = require('../quote-engine');

describe('remittance quote engine', () => {
  const now = 1_700_000_000_000;
  const signingSecret = 'test-quote-signing-secret';

  test('calculates fee, spread-adjusted FX, recipient amount, and expiry', async () => {
    const engine = createQuoteEngine({
      rateProvider: { getRate: async () => '90.12345678' },
      signingSecret,
      feeBps: 175,
      spreadBps: 50,
      ttlSeconds: 60,
      now: () => now,
    });

    const quote = await engine.createQuote({
      sendAmount: '100.00',
      sendCurrency: 'USD',
      receiveCurrency: 'INR',
      ownerId: 'user-123',
    });

    expect(quote).toMatchObject({
      ownerId: 'user-123',
      sendAmount: '100.00',
      amountDebited: '101.75',
      fee: '1.75',
      feeBps: 175,
      spreadBps: 50,
      fxRate: '90.12345678',
      recipientAmount: '8967.28',
      receiveCurrency: 'INR',
      expiresAt: '2023-11-14T22:14:20.000Z',
    });
    expect(typeof quote.fxRate).toBe('string');
    expect(typeof quote.signature).toBe('string');
  });

  test('rejects expired quotes and requires a new quote', async () => {
    let clock = now;
    const engine = createQuoteEngine({
      rateProvider: { getRate: async () => 90 },
      signingSecret,
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
      signingSecret,
    });
    await expect(engine.createQuote({ sendAmount: '10', sendCurrency: 'USD', receiveCurrency: 'INR' }))
      .rejects.toThrow('provider unavailable');
  });

  test('rejects tampered quote fields during validation', async () => {
    const engine = createQuoteEngine({
      rateProvider: { getRate: async () => '90.12345678' },
      signingSecret,
      ttlSeconds: 60,
      now: () => now,
    });
    const quote = await engine.createQuote({
      sendAmount: '100.00',
      sendCurrency: 'USD',
      receiveCurrency: 'INR',
      ownerId: 'user-123',
    });

    // Valid quote passes
    expect(engine.assertFreshForOwner(quote, 'user-123')).toBe(quote);

    // Tampering with recipientAmount fails
    expect(() => engine.assertFreshForOwner({ ...quote, recipientAmount: '999999.00' }, 'user-123'))
      .toThrow('Quote signature does not match');

    // Tampering with sendAmount fails
    expect(() => engine.assertFreshForOwner({ ...quote, sendAmount: '1.00' }, 'user-123'))
      .toThrow('Quote signature does not match');

    // Tampering with fee fails
    expect(() => engine.assertFreshForOwner({ ...quote, fee: '0.00' }, 'user-123'))
      .toThrow('Quote signature does not match');

    // Tampering with fxRate fails
    expect(() => engine.assertFreshForOwner({ ...quote, fxRate: '999.0' }, 'user-123'))
      .toThrow('Quote signature does not match');

    // Tampering with expiresAt fails
    expect(() => engine.assertFreshForOwner({ ...quote, expiresAt: new Date(now + 999999).toISOString() }, 'user-123'))
      .toThrow('Quote signature does not match');

    // Missing signature fails
    const { signature: _sig, ...unsigned } = quote;
    expect(() => engine.assertFreshForOwner(unsigned, 'user-123'))
      .toThrow('Quote signature does not match');
  });

  test('rejects quote when validated by a different owner', async () => {
    const engine = createQuoteEngine({
      rateProvider: { getRate: async () => '90.12345678' },
      signingSecret,
      ttlSeconds: 60,
      now: () => now,
    });
    const quote = await engine.createQuote({
      sendAmount: '100.00',
      sendCurrency: 'USD',
      receiveCurrency: 'INR',
      ownerId: 'user-123',
    });

    expect(() => engine.assertFreshForOwner(quote, 'different-user-456'))
      .toThrow('Quote was issued for a different account');
  });

  test('fails closed when signing is not configured', async () => {
    const engine = createQuoteEngine({
      rateProvider: { getRate: async () => 90 },
      ttlSeconds: 60,
      now: () => now,
    });
    const quote = await engine.createQuote({
      sendAmount: '1',
      sendCurrency: 'USD',
      receiveCurrency: 'INR',
    });

    expect(() => engine.assertFresh(quote)).toThrow('Quote signing is not configured on this relayer');
  });
});
