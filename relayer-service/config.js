'use strict';

const StellarSdk = require('@stellar/stellar-sdk');

const NETWORKS = Object.freeze({
  testnet: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: StellarSdk.Networks.TESTNET,
  },
  public: {
    horizonUrl: 'https://horizon.stellar.org',
    passphrase: StellarSdk.Networks.PUBLIC,
  },
});

const USDC_ISSUERS = Object.freeze({
  testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  public: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
});

/**
 * Parse and validate all relayer environment configuration before any listener
 * is created. Secrets deliberately never appear in the returned public config.
 */
function loadConfig(env = process.env) {
  const nodeEnv = optionalString(env.NODE_ENV) || 'production';
  const networkName = (optionalString(env.STELLAR_NETWORK) || 'testnet').toLowerCase();
  const network = NETWORKS[networkName];
  if (!network) {
    throw new Error(`STELLAR_NETWORK must be one of: ${Object.keys(NETWORKS).join(', ')}; received ${displayValue(env.STELLAR_NETWORK)}`);
  }

  const horizonUrl = optionalString(env.STELLAR_HORIZON_URL) || network.horizonUrl;
  const allowCustomHorizon = readBoolean(env, 'ALLOW_CUSTOM_HORIZON', false);
  const allowHttpHorizon = readBoolean(env, 'ALLOW_HTTP_HORIZON', false);
  assertTrustedHorizonUrl(horizonUrl, { allowCustomHorizon, allowHttpHorizon });

  const corsOrigin = parseCorsOrigin(optionalString(env.CORS_ORIGIN) || '*');
  if (nodeEnv === 'production' && corsOrigin === '*') {
    throw new Error('CORS_ORIGIN must name one or more trusted origins when NODE_ENV=production; "*" is not allowed');
  }

  // Authentication may only be intentionally disabled for local development.
  const authRequired = readBoolean(env, 'RELAYER_AUTH_REQUIRED', nodeEnv !== 'development');
  if (!authRequired && nodeEnv !== 'development') {
    throw new Error('RELAYER_AUTH_REQUIRED=false is allowed only when NODE_ENV=development');
  }

  const sponsorSecret = requireEnv(env, 'SPONSOR_SECRET');
  const distributionSecret = requireEnv(env, 'DISTRIBUTION_SECRET');
  const expectedUsdcIssuer = USDC_ISSUERS[networkName];
  const assetIssuer = optionalString(env.USDC_ASSET_ISSUER) || expectedUsdcIssuer;
  if (assetIssuer !== expectedUsdcIssuer) {
    throw new Error(`USDC_ASSET_ISSUER must be Circle's canonical ${networkName} issuer`);
  }

  // Never use an Expo public variable for a server-side privileged credential.
  const supabaseUrl = optionalString(env.SUPABASE_URL) || '';
  const supabaseServiceRoleKey = optionalString(env.SUPABASE_SERVICE_ROLE_KEY) || '';
  if (authRequired && (!supabaseUrl || !supabaseServiceRoleKey)) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when relayer authentication is enabled');
  }
  if (supabaseUrl) assertUrl(supabaseUrl, 'SUPABASE_URL');

  const maxAddMoneyAmount = readNumber(env, 'MAX_ADD_MONEY_AMOUNT', 1000, { min: 0, exclusiveMin: true });
  const maxPaymentAmount = readNumber(env, 'MAX_PAYMENT_AMOUNT', 1000, { min: 0, exclusiveMin: true });
  const maxPaymentDailyAmount = readNumber(env, 'MAX_PAYMENT_DAILY_AMOUNT', 5000, { min: 0, exclusiveMin: true });

  return {
    nodeEnv,
    port: readNumber(env, 'PORT', 3000, { integer: true, min: 0, max: 65535 }),
    networkName,
    horizonUrl,
    passphrase: optionalString(env.STELLAR_NETWORK_PASSPHRASE) || network.passphrase,
    sponsorSecret,
    distributionSecret,
    assetCode: 'USDC',
    assetIssuer,
    corsOrigin,
    baseFee: String(readNumber(env, 'STELLAR_BASE_FEE', StellarSdk.BASE_FEE, { integer: true, min: 0, exclusiveMin: true })),
    feeBumpMultiplier: readNumber(env, 'FEE_BUMP_MULTIPLIER', 10, { integer: true, min: 0, exclusiveMin: true }),
    transactionTimeoutSeconds: readNumber(env, 'TRANSACTION_TIMEOUT_SECONDS', 60, { integer: true, min: 0, exclusiveMin: true }),
    // Sponsored reserves make a starting balance unnecessary. Keep this
    // fixed so an environment override cannot turn sponsorship into a
    // withdrawable-XLM grant.
    startingBalance: '0',
    trustlineLimit: readDecimalString(env, 'TRUSTLINE_LIMIT', '1000000000'),
    maxSponsoredAccountsPerUser: readNumber(env, 'MAX_SPONSORED_ACCOUNTS_PER_USER', 5, { integer: true, min: 0, exclusiveMin: true }),
    addMoneyAmount: readDecimalString(env, 'ADD_MONEY_AMOUNT', '100'),
    maxAddMoneyAmount,
    maxAddMoneyDailyCap: readNumber(env, 'MAX_ADD_MONEY_DAILY_CAP', optionalValue(env, 'ADD_MONEY_DAILY_CAP', 1000), { min: 0 }),
    maxPaymentAmount,
    maxPaymentDailyAmount,
    maxPaymentDailyCount: readNumber(env, 'MAX_PAYMENT_DAILY_COUNT', 20, { integer: true, min: 0, exclusiveMin: true }),
    maxPaymentVelocityPerMinute: readNumber(env, 'MAX_PAYMENT_VELOCITY_PER_MINUTE', 10, { integer: true, min: 0, exclusiveMin: true }),
    addMoneyCooldownMs: readNumber(env, 'ADD_MONEY_COOLDOWN_MS', 24 * 60 * 60 * 1000, { integer: true, min: 0, exclusiveMin: true }),
    idempotencyTtlMs: readNumber(env, 'IDEMPOTENCY_TTL_MS', 10 * 60 * 1000, { integer: true, min: 0, exclusiveMin: true }),
    lowXlmThreshold: readNumber(env, 'LOW_XLM_THRESHOLD', 5, { min: 0 }),
    lowAssetThreshold: readNumber(env, 'LOW_USDC_THRESHOLD', 100, { min: 0 }),
    lowBalanceCheckIntervalMs: readNumber(env, 'LOW_BALANCE_CHECK_INTERVAL_MS', 5 * 60 * 1000, { integer: true, min: 0, exclusiveMin: true }),
    lowBalanceAlertWindowMs: readNumber(env, 'LOW_BALANCE_ALERT_WINDOW_MS', 60 * 60 * 1000, { integer: true, min: 0, exclusiveMin: true }),
    rateLimitWindowMs: readNumber(env, 'RATE_LIMIT_WINDOW_MS', 60000, { integer: true, min: 0, exclusiveMin: true }),
    rateLimitMaxRequests: readNumber(env, 'RATE_LIMIT_MAX_REQUESTS', 100, { integer: true, min: 0, exclusiveMin: true }),
    txRateLimitWindowMs: readNumber(env, 'TX_RATE_LIMIT_WINDOW_MS', 60000, { integer: true, min: 0, exclusiveMin: true }),
    txRateLimitMaxRequests: readNumber(env, 'TX_RATE_LIMIT_MAX_REQUESTS', 30, { integer: true, min: 0, exclusiveMin: true }),
    authRequired,
    adminToken: optionalString(env.RELAYER_ADMIN_TOKEN) || '',
    supabaseJwtSecret: optionalString(env.SUPABASE_JWT_SECRET) || '',
    // Claim enforcement. aud defaults to the Supabase 'authenticated' role and
    // iss is derived from SUPABASE_URL, so both are checked without extra
    // configuration. Both accept an explicit override; aud also accepts a
    // comma-separated list per RFC 7519.
    supabaseJwtAudience: optionalString(env.SUPABASE_JWT_AUDIENCE) || 'authenticated',
    supabaseJwtIssuer:
      optionalString(env.SUPABASE_JWT_ISSUER) ||
      (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1` : ''),
    supabaseUrl,
    supabaseServiceRoleKey,
    addMoneyEnabled: networkName === 'testnet' && readBoolean(env, 'ENABLE_TESTNET_FAUCET', false),
    ledgerIngestEnabled: readBoolean(env, 'LEDGER_INGEST_ENABLED', true),
    ingestPollIntervalMs: readNumber(env, 'INGEST_POLL_INTERVAL_MS', 5000, { integer: true, min: 0, exclusiveMin: true }),
    ingestPendingTimeoutMs: readNumber(env, 'INGEST_PENDING_TIMEOUT_MS', 300000, { integer: true, min: 0, exclusiveMin: true }),
    ingestStartCursor: optionalString(env.INGEST_START_CURSOR) || null,
    quoteFeeBps: readNumber(env, 'QUOTE_FEE_BPS', 175, { integer: true, min: 0, max: 10000 }),
    quoteSpreadBps: readNumber(env, 'QUOTE_SPREAD_BPS', 0, { integer: true, min: 0, max: 10000 }),
    quoteTtlSeconds: readNumber(env, 'QUOTE_TTL_SECONDS', 60, { integer: true, min: 0, exclusiveMin: true }),
  };
}

function readBoolean(env, name, defaultValue) {
  const value = optionalString(env[name]);
  if (value === undefined) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`${name} must be a boolean (true or false); received ${displayValue(env[name])}`);
}

function readNumber(env, name, defaultValue, options = {}) {
  const raw = optionalString(env[name]);
  const value = raw === undefined ? Number(defaultValue) : Number(raw);
  const valid = Number.isFinite(value)
    && (!options.integer || Number.isInteger(value))
    && (options.min === undefined || (options.exclusiveMin ? value > options.min : value >= options.min))
    && (options.max === undefined || value <= options.max);
  if (!valid) {
    const range = options.exclusiveMin ? `greater than ${options.min}` : options.min !== undefined ? `at least ${options.min}` : 'a finite number';
    throw new Error(`${name} must be ${options.integer ? 'an integer ' : ''}${range}; received ${displayValue(env[name])}`);
  }
  return value;
}

function readDecimalString(env, name, defaultValue) {
  const raw = optionalString(env[name]);
  const value = raw === undefined ? defaultValue : raw;
  if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0 || !Number.isFinite(Number(value))) {
    throw new Error(`${name} must be a positive decimal amount; received ${displayValue(env[name])}`);
  }
  return value;
}

function assertTrustedHorizonUrl(horizonUrl, { allowCustomHorizon, allowHttpHorizon }) {
  let parsed;
  try {
    parsed = new URL(horizonUrl);
  } catch (_) {
    throw new Error(`STELLAR_HORIZON_URL must be a valid URL; received ${displayValue(horizonUrl)}`);
  }
  const allowedHosts = new Set(['horizon-testnet.stellar.org', 'horizon.stellar.org']);
  if (parsed.protocol !== 'https:' && !allowHttpHorizon) {
    throw new Error('STELLAR_HORIZON_URL must use HTTPS unless ALLOW_HTTP_HORIZON=true');
  }
  if (!allowCustomHorizon && !allowedHosts.has(parsed.hostname)) {
    throw new Error('Custom Horizon hosts require ALLOW_CUSTOM_HORIZON=true');
  }
}

function assertUrl(value, name) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  } catch (_) {
    throw new Error(`${name} must be a valid HTTP(S) URL; received ${displayValue(value)}`);
  }
}

function parseCorsOrigin(value) {
  if (value === '*') return '*';
  const origins = value.split(',').map(origin => origin.trim()).filter(Boolean);
  if (!origins.length) throw new Error('CORS_ORIGIN must contain at least one origin');
  for (const origin of origins) assertUrl(origin, 'CORS_ORIGIN');
  return origins.length === 1 ? origins[0] : origins;
}

function requireEnv(env, name) {
  const value = optionalString(env[name]);
  if (value === undefined) throw new Error(`${name} is required`);
  return value;
}

function optionalString(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  return String(value).trim();
}

function optionalValue(env, name, fallback) {
  const value = optionalString(env[name]);
  return value === undefined ? fallback : value;
}

function displayValue(value) {
  return value === undefined || value === '' ? 'an empty value' : JSON.stringify(String(value));
}

function getPublicConfig(config) {
  return {
    nodeEnv: config.nodeEnv,
    port: config.port,
    network: config.networkName,
    horizonUrl: config.horizonUrl,
    corsOrigin: config.corsOrigin,
    authRequired: config.authRequired,
    supabaseConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
    addMoneyEnabled: config.addMoneyEnabled,
    ledgerIngestEnabled: config.ledgerIngestEnabled,
    maxPaymentAmount: config.maxPaymentAmount,
    maxPaymentDailyAmount: config.maxPaymentDailyAmount,
    maxPaymentDailyCount: config.maxPaymentDailyCount,
    maxPaymentVelocityPerMinute: config.maxPaymentVelocityPerMinute,
  };
}

module.exports = { loadConfig, getPublicConfig, NETWORKS, USDC_ISSUERS };
