const crypto = require('crypto');
'use strict';

const RATE_SCALE = 100000000n;

/**
 * Builds sender-facing remittance quotes without tying the service to a payout
 * partner. Rates are supplied by an injected provider and are never hardcoded
 * in the calculation path.
 */
const QUOTE_SIGNATURE_FIELDS = [
  'sendAmount',
  'sendCurrency',
  'amountDebited',
  'fee',
  'feeBps',
  'fxRate',
  'spreadBps',
  'recipientAmount',
  'receiveCurrency',
  'expiresAt',
  'ownerId',
];

function signQuote(quote, secret) {
  const canonical = QUOTE_SIGNATURE_FIELDS
    .map((field) => `${field}=${quote[field] === undefined ? '' : String(quote[field])}`)
    .join('\n');
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

function createQuoteEngine({
  rateProvider,
  feeBps = 175,
  spreadBps = 0,
  ttlSeconds = 60,
  now = () => Date.now(),
  // Accept either name: signingSecret is the engine's own parameter,
  // quoteSignatureSecret is what the relayer config passes through.
  signingSecret = '',
  quoteSignatureSecret,
} = {}) {
  const secret = signingSecret || quoteSignatureSecret || '';
  if (!rateProvider || typeof rateProvider.getRate !== 'function') {
    throw new TypeError('rateProvider.getRate must be provided');
  }

  const normalizedFeeBps = assertBasisPoints(feeBps, 'feeBps');
  const normalizedSpreadBps = assertBasisPoints(spreadBps, 'spreadBps');
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > 86400) {
    throw new RangeError('ttlSeconds must be an integer between 1 and 86400');
  }

  return {
    async createQuote({ sendAmount, sendCurrency, receiveCurrency, ownerId }) {
      const from = assertCurrency(sendCurrency, 'sendCurrency');
      const to = assertCurrency(receiveCurrency, 'receiveCurrency');
      const amountMinor = parseMinorAmount(sendAmount);
      if (amountMinor <= 0n) throw new RangeError('sendAmount must be greater than zero');

      const marketRate = await rateProvider.getRate({ from, to });
      const rateScaled = parseRate(marketRate);
      const effectiveRate = (rateScaled * BigInt(10000 - normalizedSpreadBps)) / 10000n;
      const receiveMinor = (amountMinor * effectiveRate) / RATE_SCALE;
      const feeMinor = (amountMinor * BigInt(normalizedFeeBps) + 9999n) / 10000n;
      const expiresAt = new Date(now() + ttlSeconds * 1000).toISOString();

      const quote = {
        ownerId: ownerId || undefined,
        sendAmount: formatMinor(amountMinor),
        sendCurrency: from,
        amountDebited: formatMinor(amountMinor + feeMinor),
        fee: formatMinor(feeMinor),
        feeBps: normalizedFeeBps,
        fxRate: Number(rateScaled) / Number(RATE_SCALE),
        spreadBps: normalizedSpreadBps,
        recipientAmount: formatMinor(receiveMinor),
        receiveCurrency: to,
        expiresAt,
        rateMovementPolicy: 'The quoted recipient amount is fixed until expiresAt; settlement must reject expired quotes and obtain a new quote.',
      };

      // The quote is only trustworthy if the relayer produced it. Without a
      // signature the client can hand back any object with a future expiresAt
      // and /quotes/validate will accept it, so the amounts are whatever the
      // caller chose rather than what the relayer quoted.
      if (secret) {
        quote.signature = signQuote(quote, secret);
      }
      return quote;
    },

    assertFreshForOwner(quote, ownerId) {
      if (!quote || !quote.expiresAt || new Date(quote.expiresAt).getTime() <= now()) {
        const error = new Error('Quote has expired; request a new quote');
        error.code = 'QUOTE_EXPIRED';
        throw error;
      }

      // Fail closed. Without a signing secret there is no way to tell a
      // relayer-issued quote from a caller-supplied object, so nothing is
      // accepted rather than falling back to the pre-existing trust-the-client
      // behaviour.
      if (!secret) {
        const error = new Error('Quote signing is not configured on this relayer');
        error.code = 'QUOTE_SIGNING_NOT_CONFIGURED';
        throw error;
      }

      // Ownership is checked before the signature so a quote replayed by the
      // wrong caller is reported as an ownership problem, not a crypto one.
      if (ownerId && quote.ownerId && quote.ownerId !== ownerId) {
        const error = new Error('Quote was issued for a different account');
        error.code = 'QUOTE_OWNER_MISMATCH';
        throw error;
      }

      const { signature, ...unsigned } = quote;
      const expected = signQuote(unsigned, secret);
      if (
        typeof signature !== 'string' ||
        signature.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
      ) {
        const error = new Error('Quote signature does not match; request a new quote');
        error.code = 'QUOTE_SIGNATURE_MISMATCH';
        throw error;
      }

      return quote;
    },

    // Backwards-compatible alias. Callers that have no owner context still get
    // the signature check; only the ownership comparison is skipped.
    assertFresh(quote) {
      return this.assertFreshForOwner(quote, null);
    },
  };
}

function assertBasisPoints(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new RangeError(`${name} must be an integer between 0 and 10000`);
  }
  return value;
}

function assertCurrency(value, name) {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw new TypeError(`${name} must be a three-letter uppercase currency code`);
  }
  return value;
}

function parseMinorAmount(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError('sendAmount must be a decimal amount');
  }
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new TypeError('sendAmount must have at most two decimals');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function parseRate(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,8})?$/.test(text) || Number(value) <= 0) {
    throw new TypeError('FX provider returned an invalid positive rate');
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(8, '0'));
}

function formatMinor(value) {
  const whole = value / 100n;
  const fraction = String(value % 100n).padStart(2, '0');
  return `${whole}.${fraction}`;
}

module.exports = { createQuoteEngine };
