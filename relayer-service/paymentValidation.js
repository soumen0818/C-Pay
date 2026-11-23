'use strict';

const StellarSdk = require('@stellar/stellar-sdk');

const ALLOWED_MEMO_TYPES = new Set(['none', 'text', 'id', 'hash']);
const MAX_MEMO_TEXT_BYTES = 28;
const BASE64_ENVELOPE_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DEFAULT_MAX_TIMEBOUND_MINUTES = 15;
const DEFAULT_USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function isTransactionEnvelopeXdr(value) {
  try {
    const envelope = StellarSdk.xdr.TransactionEnvelope.fromXDR(value, 'base64');
    const envelopeType = envelope.switch();
    return (
      envelopeType === StellarSdk.xdr.EnvelopeType.envelopeTypeTx() ||
      envelopeType === StellarSdk.xdr.EnvelopeType.envelopeTypeTxV0()
    );
  } catch {
    return false;
  }
}

function assertTransactionEnvelopeXdr(value) {
  if (typeof value !== 'string') {
    const error = new Error('Invalid transaction XDR');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 20000) {
    const error = new Error('Invalid transaction XDR');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  // Accept base64 XDR only: reject hex, comma-separated bytes, or non-base64 formatting
  if (trimmed.length % 4 !== 0 || !BASE64_ENVELOPE_REGEX.test(trimmed)) {
    const error = new Error('Invalid transaction XDR: only base64 encoding is accepted');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  if (!isTransactionEnvelopeXdr(trimmed)) {
    const error = new Error('Invalid transaction XDR');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  return trimmed;
}

function assertAccountId(value, label = 'account ID') {
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(value || '')) {
    const error = new Error(`Invalid Stellar ${label}`);
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  return value;
}

function normalizeAmount(value, maxAmount) {
  const amount = String(value).trim();

  if (!/^\d+(\.\d{1,7})?$/.test(amount)) {
    const error = new Error('Amount must be a positive number with up to 7 decimal places');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0 || (maxAmount && numeric > maxAmount)) {
    const error = new Error(`Amount must be greater than 0 and no more than ${maxAmount}`);
    error.statusCode = 400;
    error.expose = true;
    if (maxAmount && numeric > maxAmount) {
      error.code = 'PAYMENT_AMOUNT_EXCEEDED';
    }
    throw error;
  }

  return amount;
}

function validateTransactionMemo(memo) {
  if (!memo) return;

  const type = memo.type;
  if (!ALLOWED_MEMO_TYPES.has(type)) {
    const error = new Error(`Unsupported memo type: ${type}`);
    error.statusCode = 400;
    error.expose = true;
    error.code = 'UNSUPPORTED_MEMO_TYPE';
    throw error;
  }

  if (type === 'text') {
    const value = memo.value ?? '';
    if (typeof value !== 'string') {
      const error = new Error('Memo text must be a string');
      error.statusCode = 400;
      error.expose = true;
      error.code = 'INVALID_MEMO_TEXT';
      throw error;
    }
    const byteLength = Buffer.byteLength(value, 'utf8');
    if (byteLength > MAX_MEMO_TEXT_BYTES) {
      const error = new Error(`Memo text exceeds maximum allowed length of ${MAX_MEMO_TEXT_BYTES} bytes`);
      error.statusCode = 400;
      error.expose = true;
      error.code = 'MEMO_TEXT_TOO_LONG';
      throw error;
    }
  } else if (type === 'id') {
    const valueStr = String(memo.value ?? '');
    if (!/^\d+$/.test(valueStr)) {
      const error = new Error('Memo ID must be a valid non-negative integer string');
      error.statusCode = 400;
      error.expose = true;
      error.code = 'INVALID_MEMO_ID';
      throw error;
    }
    try {
      const idBigInt = BigInt(valueStr);
      if (idBigInt < 0n || idBigInt > 18446744073709551615n) {
        throw new Error();
      }
    } catch {
      const error = new Error('Memo ID out of range for uint64');
      error.statusCode = 400;
      error.expose = true;
      error.code = 'INVALID_MEMO_ID';
      throw error;
    }
  } else if (type === 'hash') {
    const value = memo.value;
    const isBuffer = Buffer.isBuffer(value);
    const isHexStr = typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
    if (!isBuffer && !isHexStr) {
      const error = new Error('Memo hash must be a 32-byte Buffer or 64-character hex string');
      error.statusCode = 400;
      error.expose = true;
      error.code = 'INVALID_MEMO_HASH';
      throw error;
    }
    if (isBuffer && value.length !== 32) {
      const error = new Error('Memo hash must be exactly 32 bytes');
      error.statusCode = 400;
      error.expose = true;
      error.code = 'INVALID_MEMO_HASH';
      throw error;
    }
  }
}

async function checkDestinationTrustline(destination, { server, assetCode = 'USDC', assetIssuer } = {}) {
  try {
    const account = await server.loadAccount(destination);
    const hasTrustline = account.balances.some(balance =>
      balance.asset_code === assetCode &&
      (!assetIssuer || balance.asset_issuer === assetIssuer)
    );
    return { exists: true, hasTrustline, sequence: account.sequence };
  } catch (error) {
    if (error?.response?.status === 404) {
      return { exists: false, hasTrustline: false };
    }
    throw error;
  }
}

async function validatePaymentTransaction(transaction, options = {}) {
  if (!transaction.source) {
    const error = new Error('Transaction source is required');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  if (!transaction.operations || transaction.operations.length !== 1) {
    const error = new Error('Payment transaction must contain exactly one operation');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  const operation = transaction.operations[0];
  if (operation.type !== 'payment') {
    const error = new Error('Only payment operations are accepted');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  const operationSource = operation.source || transaction.source;
  if (operationSource !== transaction.source) {
    const error = new Error('Payment operation source must match transaction source');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  assertAccountId(operation.destination, 'destination');

  if (operation.destination === transaction.source) {
    const error = new Error('Self-payments are not permitted');
    error.statusCode = 400;
    error.expose = true;
    error.code = 'SELF_PAYMENT_PROHIBITED';
    throw error;
  }

  const maxAmount = options.maxPaymentAmount !== undefined
    ? options.maxPaymentAmount
    : (options.config?.maxPaymentAmount || 1000);
  normalizeAmount(operation.amount, maxAmount);

  const expectedAssetCode = options.assetCode || options.config?.assetCode || 'USDC';
  const expectedAssetIssuer = options.assetIssuer || options.config?.assetIssuer || DEFAULT_USDC_TESTNET_ISSUER;

  if (
    !operation.asset ||
    operation.asset.code !== expectedAssetCode ||
    operation.asset.issuer !== expectedAssetIssuer
  ) {
    const error = new Error('Payment asset is not supported');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  // Timebounds validation
  const now = options.now !== undefined ? options.now : Math.floor(Date.now() / 1000);
  const maxMinutes = options.maxTimeboundMinutes !== undefined
    ? options.maxTimeboundMinutes
    : (options.config?.maxPaymentTimeboundMinutes || DEFAULT_MAX_TIMEBOUND_MINUTES);
  const maxWindowSeconds = maxMinutes * 60;

  if (
    !transaction.timeBounds ||
    !transaction.timeBounds.maxTime ||
    transaction.timeBounds.maxTime === '0' ||
    Number(transaction.timeBounds.maxTime) === 0
  ) {
    const error = new Error('Payment transaction must specify an upper time bound (maxTime)');
    error.statusCode = 400;
    error.expose = true;
    error.code = 'MISSING_TIME_BOUNDS';
    throw error;
  }

  const maxTime = Number(transaction.timeBounds.maxTime);
  const minTime = transaction.timeBounds.minTime ? Number(transaction.timeBounds.minTime) : 0;

  if (minTime > now) {
    const error = new Error('Payment transaction minTime is in the future');
    error.statusCode = 400;
    error.expose = true;
    error.code = 'TIME_BOUNDS_NOT_YET_VALID';
    throw error;
  }

  if (maxTime < now) {
    const error = new Error('Payment transaction has already expired');
    error.statusCode = 400;
    error.expose = true;
    error.code = 'TIME_BOUNDS_EXPIRED';
    throw error;
  }

  if (maxTime > now + maxWindowSeconds) {
    const error = new Error(`Payment transaction maxTime exceeds maximum allowed window of ${maxMinutes} minutes`);
    error.statusCode = 400;
    error.expose = true;
    error.code = 'TIME_BOUNDS_WINDOW_EXCEEDED';
    throw error;
  }

  // Memo validation
  validateTransactionMemo(transaction.memo);

  // Optional destination trustline pre-check
  const shouldCheckDestination = options.checkDestination !== undefined
    ? options.checkDestination
    : (options.server ? true : false);
  const serverInstance = options.server || null;

  if (shouldCheckDestination && serverInstance) {
    const status = options.getAccountStatus
      ? await options.getAccountStatus(operation.destination, serverInstance)
      : await checkDestinationTrustline(operation.destination, {
          server: serverInstance,
          assetCode: expectedAssetCode,
          assetIssuer: expectedAssetIssuer,
        });

    if (!status.exists) {
      const error = new Error('Destination account does not exist');
      error.statusCode = 400;
      error.expose = true;
      error.code = 'DESTINATION_ACCOUNT_NOT_FOUND';
      throw error;
    }
    if (!status.hasTrustline) {
      const error = new Error(`Destination account does not have a ${expectedAssetCode} trustline`);
      error.statusCode = 400;
      error.expose = true;
      error.code = 'DESTINATION_MISSING_TRUSTLINE';
      throw error;
    }
  }

  return {
    source: transaction.source,
    destination: operation.destination,
    amount: operation.amount,
  };
}

module.exports = {
  assertTransactionEnvelopeXdr,
  isTransactionEnvelopeXdr,
  validateTransactionMemo,
  validatePaymentTransaction,
  checkDestinationTrustline,
  ALLOWED_MEMO_TYPES,
  MAX_MEMO_TEXT_BYTES,
  DEFAULT_MAX_TIMEBOUND_MINUTES,
};
