require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const StellarSdk = require('@stellar/stellar-sdk');
const { createQuoteEngine } = require('./quote-engine');
const { loadConfig, getPublicConfig } = require('./config');

const app = express();
const config = loadConfig();
const PORT = config.port;
const quoteEngine = createQuoteEngine({
  rateProvider: {
    async getRate({ from, to }) {
      if (from === to) return 1;
      const configuredRates = parseConfiguredQuoteRates();
      const rate = configuredRates[`${from}_${to}`];
      if (rate === undefined) {
        const error = new Error(`No FX rate configured for ${from}/${to}`);
        error.code = 'FX_RATE_UNAVAILABLE';
        throw error;
      }
      return rate;
    },
  },
  feeBps: config.quoteFeeBps,
  spreadBps: config.quoteSpreadBps,
  signingSecret: config.quoteSignatureSecret,
  ttlSeconds: config.quoteTtlSeconds,
});
const server = new StellarSdk.Horizon.Server(config.horizonUrl, {
  allowHttp: config.horizonUrl.startsWith('http://'),
});
const { KeyManager } = require('./keyManager');
const keyManager = new KeyManager({
  sponsorSecret: config.sponsorSecret,
  distributionSecret: config.distributionSecret,
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
});
const sponsorSigner = {
  publicKey: () => keyManager.getSigner('sponsor').publicKey(),
  sign: (tx) => keyManager.getSigner('sponsor').sign(tx),
};
const distributionSigner = {
  publicKey: () => keyManager.getSigner('distribution').publicKey(),
  sign: (tx) => keyManager.getSigner('distribution').sign(tx),
};
const usdcAsset = new StellarSdk.Asset(config.assetCode, config.assetIssuer);

const {
  SupabaseRequestError,
  executeSupabaseRequest,
  isPostgresUniqueViolation,
} = require('./supabaseRest');

const { IngestWorker } = require('./ingestWorker');
const ingestWorker = new IngestWorker({
  horizonUrl: config.horizonUrl,
  assetCode: config.assetCode,
  assetIssuer: config.assetIssuer,
  supabaseUrl: config.supabaseUrl,
  supabaseServiceRoleKey: config.supabaseServiceRoleKey,
  pollIntervalMs: config.ingestPollIntervalMs,
  pendingTimeoutMs: config.ingestPendingTimeoutMs,
  startCursor: config.ingestStartCursor,
});

/**
 * Persisted low-balance alert deduplication.
 * Eviction & deduplication policy:
 * - Alerts are deduplicated across all relayer instances using relayer_idempotency_keys.
 * - Alert window TTL: LOW_BALANCE_ALERT_WINDOW_MS (default: 1 hour).
 * - Fires at most once per window across all instances.
 * - Automatically reset when balances recover above threshold.
 */
const LOW_BALANCE_ALERT_WINDOW_MS = config.lowBalanceAlertWindowMs;
let localLowBalanceAlertUntil = 0;

/**
 * Bounded cache for prepared account transactions.
 * Eviction policy:
 * - Time-To-Live (TTL): 5 minutes (PREPARED_ACCOUNT_TRANSACTION_TTL_MS).
 * - Maximum capacity: 10,000 entries (MAX_PREPARED_ACCOUNT_TRANSACTIONS).
 * - FIFO eviction: Oldest entries evicted when capacity is reached.
 */
const PREPARED_ACCOUNT_TRANSACTION_TTL_MS = 5 * 60 * 1000;
const MAX_PREPARED_ACCOUNT_TRANSACTIONS = 10000;
const preparedAccountTransactions = Object.create(null);
const inMemoryPaymentRecords = [];

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '64kb' }));

const limiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.use(limiter);

app.get('/', (_req, res) => {
  res.json({
    service: 'C-Pay Stellar Relayer',
    health: '/health',
  });
});

app.get('/ingest/health', requireAdminToken, (_req, res) => {
  res.json(ingestWorker.getHealth());
});

// Keep the public probe free of infrastructure and account data.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/quotes', requireAuthenticatedUser, async (req, res) => {
  try {
    // The quote is bound to the requesting account at mint time so it cannot be
    // replayed by a different caller.
    const quote = await quoteEngine.createQuote({
      sendAmount: req.body.sendAmount,
      sendCurrency: req.body.sendCurrency,
      receiveCurrency: req.body.receiveCurrency,
      ownerId: req.auth && req.auth.sub,
    });
    res.status(201).json(quote);
  } catch (error) {
    const status = error.code === 'FX_RATE_UNAVAILABLE' ? 503 : 400;
    res.status(status).json({ error: error.message, code: error.code || 'INVALID_QUOTE_REQUEST' });
  }
});

app.post('/quotes/validate', requireAuthenticatedUser, (req, res) => {
  try {
    const quote = quoteEngine.assertFreshForOwner(req.body, req.auth && req.auth.sub);
    res.json(quote);
  } catch (error) {
    // Distinct codes so the client can tell "expired, fetch a new quote" from
    // "this quote was not issued by the relayer or was issued to someone else".
    res.status(410).json({ error: error.message, code: error.code || 'QUOTE_EXPIRED' });
  }
});

app.get('/health/detailed', requireAdminToken, async (_req, res) => {
  try {
    const [sponsorBalances, distributionBalances] = await Promise.all([
      getBalances(sponsorSigner.publicKey()),
      getBalances(distributionSigner.publicKey()),
    ]);

    const sponsorXlm = Number(sponsorBalances.xlm || '0');
    const distributionAsset = Number(distributionBalances.asset || '0');

    res.json({
      status: 'healthy',
      network: config.networkName,
      assetCode: config.assetCode,
      assetIssuer: config.assetIssuer,
      sponsorPublicKey: sponsorSigner.publicKey(),
      distributionPublicKey: distributionSigner.publicKey(),
      sponsorXlmBalance: sponsorBalances.xlm,
      distributionUsdcBalance: distributionBalances.asset,
      authRequired: config.authRequired,
      authApiConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
      legacyJwtSecretConfigured: Boolean(config.supabaseJwtSecret),
      supabasePersistenceEnabled: isSupabasePersistenceEnabled(),
      ingest: ingestWorker.getHealth(),
      lowXlm: sponsorXlm < config.lowXlmThreshold,
      lowAsset: distributionAsset < config.lowAssetThreshold,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Detailed health check failed:', error.message);
    res.status(500).json({
      error: 'Detailed health check failed',
      code: 'HEALTH_CHECK_FAILED',
    });
  }
});

app.get('/account/:accountId/status', requireAuthenticatedUser, requirePathWalletOwnership(), async (req, res) => {
  const accountId = assertAccountId(req.params.accountId, 'accountId');
  const authUserId = req.auth && req.auth.sub ? req.auth.sub : null;
  const [status, retryAfterSeconds] = await Promise.all([
    getAccountStatus(accountId),
    getAddMoneyRetryAfterSeconds(accountId, authUserId),
  ]);

  res.json({
    ...status,
    addMoneyReady: status.exists && status.hasTrustline,
    retryAfterSeconds,
  });
});

app.get('/account/:accountId/balance', requireAuthenticatedUser, requirePathWalletOwnership(), async (req, res) => {
  const accountId = assertAccountId(req.params.accountId, 'accountId');
  const balances = await getBalances(accountId);
  res.json({
    accountId,
    assetCode: config.assetCode,
    assetIssuer: config.assetIssuer,
    balance: balances.asset,
    xlmBalance: balances.xlm,
  });
});

app.post(
  '/accounts/prepare',
  rejectUnauthenticatedPublicSponsorship,
  requireAuthenticatedUser,
  requireAccountPreparationOwnership('accountId'),
  async (req, res) => {
    const accountId = assertAccountId(req.body.accountId, 'accountId');

    const status = await getAccountStatus(accountId);

  if (status.exists && status.hasTrustline) {
    return res.json({
      alreadyReady: true,
      accountId,
      sponsorPublicKey: sponsorSigner.publicKey(),
    });
  }

  const sponsorAccount = await server.loadAccount(sponsorSigner.publicKey());
  const builder = new StellarSdk.TransactionBuilder(sponsorAccount, {
    fee: config.baseFee,
    networkPassphrase: config.passphrase,
  });

  builder.addOperation(StellarSdk.Operation.beginSponsoringFutureReserves({
    sponsoredId: accountId,
  }));

  if (!status.exists) {
    builder.addOperation(StellarSdk.Operation.createAccount({
      destination: accountId,
      startingBalance: config.startingBalance,
    }));
  }

  builder.addOperation(StellarSdk.Operation.changeTrust({
    asset: usdcAsset,
    limit: config.trustlineLimit,
    source: accountId,
  }));

  builder.addOperation(StellarSdk.Operation.endSponsoringFutureReserves({
    source: accountId,
  }));

  const transaction = builder
    .setTimeout(config.transactionTimeoutSeconds)
    .build();
  sponsorSigner.sign(transaction);

  rememberPreparedAccountTransaction(req.auth?.sub || 'auth-disabled', transaction);

  res.json({
    alreadyReady: false,
    accountId,
    xdr: transaction.toXDR(),
    networkPassphrase: config.passphrase,
    sponsorPublicKey: sponsorSigner.publicKey(),
    requiresAccountSignature: true,
  });
});

app.post('/accounts/submit', requireAuthenticatedUser, requireWalletOwnership(), async (req, res) => {
  const signedXdr = assertTransactionEnvelopeXdr(req.body.signedXdr);
  const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, config.passphrase);

  const authUid = req.auth?.sub || 'auth-disabled';
  const prepared = getPreparedAccountTransaction(authUid, tx);
  if (!prepared) {
    return res.status(403).json({
      error: 'This transaction was not prepared for your account or has expired',
      code: 'WALLET_OWNERSHIP_DENIED',
    });
  }

  if (prepared.inFlight) {
    return res.status(409).json({
      error: 'This account setup is already being submitted',
      code: 'ACCOUNT_SETUP_IN_FLIGHT',
    });
  }
  prepared.inFlight = true;

  let result;
  try {
    result = await server.submitTransaction(tx);
  } catch (error) {
    prepared.inFlight = false;
    throw error;
  }

  preparedAccountTransactions.delete(prepared.key);

  res.json({
    hash: result.hash,
    ledger: result.ledger,
    status: 'success',
  });
});

app.post('/payments/submit', requireAuthenticatedUser, requireWalletOwnership(), async (req, res) => {
  const signedXdr = assertTransactionEnvelopeXdr(req.body.signedXdr);
  const idempotencyKey = normalizeOptionalString(req.body.idempotencyKey);
  const authUid = req.auth && req.auth.sub;

  if (idempotencyKey) {
    const lock = await acquireClientIdempotencyLock(authUid, idempotencyKey, signedXdr, config.idempotencyTtlMs);
    if (lock.mismatch) return res.status(422).json({ error: 'Idempotency key was already used with a different request', code: 'IDEMPOTENCY_KEY_REUSED' });
    if (!lock.acquired) {
      if (lock.response === null) {
        return res.status(409).json({
          error: 'A request with this idempotency key is currently processing',
          code: 'IDEMPOTENCY_IN_FLIGHT',
          retryAfterSeconds: 5,
        });
      }
      return res.json(lock.response);
    }
    res.once('finish', () => {
      if (res.statusCode >= 400) releaseClientIdempotencyLock(authUid, idempotencyKey).catch(() => {});
    });
  }

  const innerTransaction = StellarSdk.TransactionBuilder.fromXDR(signedXdr, config.passphrase);
  
  if (req.resolvedWallets && !req.resolvedWallets.includes(innerTransaction.source)) {
    return res.status(403).json({
      error: 'You are not authorized to submit transactions for this wallet',
      code: 'WALLET_OWNERSHIP_DENIED',
    });
  }

  const paymentDetails = validatePaymentTransaction(innerTransaction);

  const walletAddress = innerTransaction.source;

  try {
    await checkPaymentLimits(walletAddress, authUid, paymentDetails.amount);
  } catch (limitErr) {
    if (limitErr.statusCode) {
      return res.status(limitErr.statusCode).json({
        error: limitErr.message,
        code: limitErr.code,
        ...(limitErr.retryAfterSeconds ? { retryAfterSeconds: limitErr.retryAfterSeconds } : {}),
        ...(limitErr.details || {}),
      });
    }
    return res.status(503).json({
      error: 'Payment limits service is temporarily unavailable',
      code: 'PAYMENT_LIMITS_UNAVAILABLE',
      retryable: true,
    });
  }

  const maxFee = (BigInt(config.baseFee) * BigInt(config.feeBumpMultiplier)).toString();
  const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    sponsorSigner.publicKey(),
    maxFee,
    innerTransaction,
    config.passphrase
  );
  sponsorSigner.sign(feeBump);

  const result = await server.submitTransaction(feeBump);

  await recordPaymentRecord({
    walletAddress,
    authUserId: authUid,
    amount: paymentDetails.amount,
    txHash: result.hash,
  }).catch(err => {
    console.error('Failed to record payment limits entry:', err.message);
  });

  const response = {
    hash: result.hash,
    ledger: result.ledger,
    status: 'success',
  };

  if (idempotencyKey) {
    await setClientIdempotencyResponse(authUid, idempotencyKey, response);
  }

  res.json(response);
});

app.get(['/payments/limits', '/limits'], requireAuthenticatedUser, async (req, res) => {
  try {
    const authUid = req.auth && req.auth.sub;
    const walletAddress = req.query.accountId || (req.resolvedWallets && req.resolvedWallets[0]);
    const limits = await getPaymentLimitsStatus(authUid, walletAddress);
    res.json(limits);
  } catch (error) {
    console.error('Failed to get payment limits:', error.message);
    res.status(503).json({
      error: 'Payment limits service is temporarily unavailable',
      code: 'PAYMENT_LIMITS_UNAVAILABLE',
    });
  }
});

app.post('/add-money', requireAuthenticatedUser, requireWalletOwnership('accountId'), async (req, res) => {
  if (!config.addMoneyEnabled) {
    return res.status(403).json({
      error: 'Add Money is disabled for this network',
      code: 'ADD_MONEY_DISABLED',
    });
  }

  if (!isSupabasePersistenceEnabled()) {
    return res.status(503).json({
      error: 'Add Money persistence is temporarily unavailable',
      code: 'ADD_MONEY_PERSISTENCE_UNAVAILABLE',
      retryable: true,
    });
  }

  const accountId = assertAccountId(req.body.accountId, 'accountId');
  const amount = normalizeAmount(req.body.amount || config.addMoneyAmount, config.maxAddMoneyAmount);
  const idempotencyKey = normalizeOptionalString(req.body.idempotencyKey);
  const authUserId = req.auth && req.auth.sub ? req.auth.sub : null;
  const userLockKey = `add-money-user:${authUserId || accountId}`;

  if (idempotencyKey) {
    const requestBody = JSON.stringify({ accountId, amount });
    const lock = await acquireClientIdempotencyLock(authUserId, idempotencyKey, requestBody, config.idempotencyTtlMs);
    if (lock.mismatch) return res.status(422).json({ error: 'Idempotency key was already used with a different request', code: 'IDEMPOTENCY_KEY_REUSED' });
    if (!lock.acquired) {
      if (lock.response === null) {
        return res.status(409).json({
          error: 'A request with this idempotency key is currently processing',
          code: 'IDEMPOTENCY_IN_FLIGHT',
          retryAfterSeconds: 5,
        });
      }
      return res.json(lock.response);
    }
    res.once('finish', () => {
      if (res.statusCode >= 400) releaseClientIdempotencyLock(authUserId, idempotencyKey).catch(() => {});
    });
  }

  // Acquire user-level lock to prevent concurrent claims (race condition)
  const userLock = await acquireAddMoneyUserLock(userLockKey, config.transactionTimeoutSeconds * 1000 + 5000);
  if (!userLock.acquired) {
    return res.status(429).json({
      error: 'An Add Money request is already in progress for this account',
      code: 'ADD_MONEY_IN_FLIGHT',
      retryAfterSeconds: 5,
    });
  }

  try {
    const retryAfterSeconds = await getAddMoneyRetryAfterSeconds(accountId, authUserId);
    if (retryAfterSeconds > 0) {
      return res.status(429).json({
        error: 'Add Money is cooling down for this account',
        code: 'ADD_MONEY_COOLDOWN',
        retryAfterSeconds,
      });
    }

    const dailyCapCheck = await checkAddMoneyDailyCap(accountId, authUserId, amount);
    if (!dailyCapCheck.allowed) {
      return res.status(429).json({
        error: 'Daily Add Money limit reached. Please try again later.',
        code: 'ADD_MONEY_DAILY_CAP_EXCEEDED',
        retryAfterSeconds: dailyCapCheck.retryAfterSeconds,
        dailyCap: config.maxAddMoneyDailyCap,
        claimedToday: dailyCapCheck.totalClaimed,
      });
    }

    const status = await getAccountStatus(accountId);
    if (!status.exists || !status.hasTrustline) {
      return res.status(409).json({
        error: 'Account is not ready to receive Add Money balance',
        code: 'ACCOUNT_NOT_READY',
      });
    }

    const distributionBalances = await getBalances(distributionSigner.publicKey());
    if (Number(distributionBalances.asset || '0') < Number(amount)) {
      return res.status(503).json({
        error: `Add Money is temporarily unavailable because the relayer distribution account has insufficient ${config.assetCode}.`,
        code: 'DISTRIBUTION_LOW_ASSET',
        distributionBalance: distributionBalances.asset,
        requiredAmount: amount,
      });
    }

    const claimId = crypto.randomUUID();
    const nextAvailableAt = new Date(Date.now() + config.addMoneyCooldownMs).toISOString();
    await reserveAddMoneyClaim({
      claimId,
      walletAddress: accountId,
      authUserId,
      amount,
      idempotencyKey,
      nextAvailableAt,
    });

    const distributionAccount = await server.loadAccount(distributionSigner.publicKey());
    const tx = new StellarSdk.TransactionBuilder(distributionAccount, {
      fee: config.baseFee,
      networkPassphrase: config.passphrase,
    })
      .addOperation(StellarSdk.Operation.payment({
        destination: accountId,
        asset: usdcAsset,
        amount,
      }))
      .addMemo(StellarSdk.Memo.text('add-money'))
      .setTimeout(config.transactionTimeoutSeconds)
      .build();

    distributionSigner.sign(tx);

    const result = await server.submitTransaction(tx);
    const response = {
      hash: result.hash,
      ledger: result.ledger,
      status: 'success',
      amount,
      assetCode: config.assetCode,
    };

    await settleAddMoneyClaim(claimId, result.hash);

    if (idempotencyKey) {
      await setClientIdempotencyResponse(authUserId, idempotencyKey, response);
    }

    return res.json(response);
  } finally {
    await releaseAddMoneyUserLock(userLockKey);
  }
});

const txLimiter = rateLimit({
  windowMs: config.txRateLimitWindowMs,
  max: config.txRateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many transaction status requests, please try again later' },
});

app.get('/tx/:hash', requireAuthenticatedUser, txLimiter, async (req, res) => {
  const hash = normalizeOptionalString(req.params.hash);
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid transaction hash' });
  }

  try {
    const tx = await server.transactions().transaction(hash).call();
    const failed = tx.successful === false;
    const response = {
      hash,
      status: failed ? 'failed' : 'success',
      ledger: tx.ledger,
      createdAt: tx.created_at,
      feeCharged: tx.fee_charged,
    };

    // Horizon includes failed transactions in this lookup too. Prefer its
    // structured codes when present; result_xdr is decoded as a fallback for
    // the normal Horizon transaction representation.
    if (failed) {
      response.result_codes = getHorizonTransactionResultCodes(tx);
    }

    return res.json(response);
  } catch (error) {
    if (error?.response?.status === 404) {
      // A missing hash has not been accepted by Horizon. It is distinct from
      // a submitted transaction which is still awaiting a ledger outcome.
      return res.json({ hash, status: 'not_found' });
    }
    throw error;
  }
});

function getHorizonTransactionResultCodes(tx) {
  if (tx?.result_codes && typeof tx.result_codes === 'object') {
    return tx.result_codes;
  }
  if (tx?.resultCodes && typeof tx.resultCodes === 'object') {
    return tx.resultCodes;
  }
  if (!tx?.result_xdr) {
    return null;
  }

  try {
    const result = StellarSdk.xdr.TransactionResult.fromXDR(tx.result_xdr, 'base64');
    const resultBody = result.result();
    const transaction = formatStellarResultCode(resultBody.switch());
    const operationResults = resultBody.results ? resultBody.results() : [];
    const operations = operationResults.map(getOperationResultCode);

    return {
      transaction,
      ...(operations.length > 0 ? { operations } : {}),
    };
  } catch (_) {
    // Result-code enrichment must never turn a known failed transaction into
    // an endpoint failure when Horizon supplies an unfamiliar XDR variant.
    return null;
  }
}

function formatStellarResultCode(code) {
  const value = typeof code?.name === 'string' ? code.name : String(code || '');
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function getOperationResultCode(operationResult) {
  const outerCode = operationResult.switch();
  if (outerCode?.name !== 'opInner') {
    return formatStellarResultCode(outerCode);
  }

  // An opInner result wraps an operation-specific result union. Its value is
  // the relevant result-code union (for example paymentUnderfunded).
  return formatStellarResultCode(operationResult.tr().value().switch());
}

function handleRelayerError(error, _req, res, _next) {
  const horizonStatus = error.response?.status;
  const horizonExtras = error.response?.data?.extras;
  const resultCodes = horizonExtras?.result_codes;
  const status = error.statusCode || error.status || horizonStatus || 500;
  const stellarCode = resultCodes?.operations?.find(code => code !== 'op_success') || resultCodes?.transaction;
  const isExposable = error.expose === true;
  const stellarMessage = getStellarErrorMessage(resultCodes);
  const message = isExposable ? (stellarMessage || error.message) : 'Relayer service error';
  const code = isExposable
    ? (error.code || (stellarCode ? `STELLAR_${stellarCode.toUpperCase()}` : 'REQUEST_FAILED'))
    : 'INTERNAL_ERROR';

  if (!isExposable) {
    console.error('Relayer error:', {
      message: error.message,
      code: error.code,
      status,
      stack: error.stack,
    });
  }

  const response = {
    error: isExposable ? (stellarMessage || message) : message,
    code,
    retryable: error.retryable || undefined,
  };
  if (isExposable && resultCodes) {
    response.resultCodes = resultCodes;
  }
  res.status(status).json(response);
}

app.use(handleRelayerError);

let relayerHttpServer = null;

async function startRelayer() {
  if (config.authRequired) {
    await assertWalletBindingsReachable();
  }

  relayerHttpServer = await new Promise((resolve, reject) => {
    const listener = app.listen(PORT, '0.0.0.0');
    listener.once('error', reject);
    listener.once('listening', () => resolve(listener));
  });
  relayerHttpServer.ref();

  console.log(`C-Pay Stellar relayer listening on port ${PORT}`);
  console.log('Effective relayer configuration:', getPublicConfig(config));

  // Start ledger ingest worker on startup (non-blocking)
  if (config.ledgerIngestEnabled && ingestWorker.isConfigured) {
    ingestWorker.start('stream').catch(err => {
      console.warn('Ingest worker startup warning:', err.message);
    });
  }

  // Clean up expired persisted state on startup (non-blocking)
  cleanExpiredPersistedState().catch(err => {
    console.error('Startup cleanup of persisted state failed:', err.message);
  });
  setInterval(() => cleanExpiredPersistedState().catch(() => {}), 60 * 60 * 1000).unref();

  setInterval(() => {
    checkLowBalanceAlerts().catch(error => {
      console.error('Scheduled low-balance check failed:', error.message);
    });
  }, config.lowBalanceCheckIntervalMs).unref();

  return relayerHttpServer;
}

const startupPromise = startRelayer();
startupPromise.catch(error => {
  console.error('Relayer startup failed:', error.message);
  if (require.main === module) {
    process.exitCode = 1;
  }
});

function parseConfiguredQuoteRates() {
  const raw = process.env.QUOTE_FX_RATES_JSON || '{}';
  try {
    const rates = JSON.parse(raw);
    if (!rates || typeof rates !== 'object' || Array.isArray(rates)) throw new Error('must be an object');
    return rates;
  } catch (error) {
    const configError = new Error(`QUOTE_FX_RATES_JSON must be valid JSON: ${error.message}`);
    configError.code = 'FX_RATE_UNAVAILABLE';
    throw configError;
  }
}

async function requireAuthenticatedUser(req, res, next) {
  if (!config.authRequired) {
    return next();
  }

  try {
    req.auth = await verifySupabaseJwt(req.get('authorization') || '');
    return next();
  } catch (error) {
    return res.status(401).json({
      error: error.message || 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }
}

function requireAdminToken(req, res, next) {
  if (!config.adminToken) {
    return res.status(503).json({
      error: 'Operator access is not configured',
      code: 'ADMIN_AUTH_NOT_CONFIGURED',
    });
  }

  const providedToken = req.get('x-admin-token') || '';
  const expectedDigest = crypto.createHash('sha256').update(config.adminToken).digest();
  const providedDigest = crypto.createHash('sha256').update(providedToken).digest();
  if (!crypto.timingSafeEqual(providedDigest, expectedDigest)) {
    return res.status(403).json({
      error: 'Operator access required',
      code: 'ADMIN_AUTH_REQUIRED',
    });
  }

  return next();
}

/**
 * Resolve the wallet address(es) that belong to an authenticated Supabase user.
 * Configuration absence, lookup failure, and a successful empty result are
 * deliberately distinct so callers cannot turn infrastructure failures into
 * authorization bypasses.
 */
async function resolveUserWallets(authUid) {
  if (!isSupabasePersistenceEnabled()) {
    return { configured: false };
  }

  try {
    const query = new URLSearchParams({
      select: 'wallet_address',
      auth_user_id: `eq.${authUid}`,
      is_active: 'eq.true',
    });
    const rows = await supabaseRestRequest(`wallet_bindings?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!Array.isArray(rows)) {
      throw new Error('Wallet ownership lookup returned an invalid response');
    }
    return {
      configured: true,
      ok: true,
      wallets: rows.map(r => r.wallet_address).filter(Boolean),
    };
  } catch (error) {
    console.warn('Wallet ownership lookup failed:', error.message);
    return { configured: true, ok: false, error };
  }
}

/**
 * Resolve the auth user ID that owns a given wallet address.
 * A successful unbound lookup is represented by owner: null.
 */
async function resolveWalletOwner(walletAddress) {
  if (!isSupabasePersistenceEnabled()) {
    return { configured: false };
  }

  try {
    const query = new URLSearchParams({
      select: 'auth_user_id',
      wallet_address: `eq.${walletAddress}`,
      is_active: 'eq.true',
      limit: '1',
    });
    const rows = await supabaseRestRequest(`wallet_bindings?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!Array.isArray(rows)) {
      throw new Error('Wallet owner lookup returned an invalid response');
    }
    return {
      configured: true,
      ok: true,
      owner: rows.length > 0 && rows[0]?.auth_user_id ? rows[0].auth_user_id : null,
    };
  } catch (error) {
    console.warn('Wallet owner lookup failed:', error.message);
    return { configured: true, ok: false, error };
  }
}

function sendWalletOwnershipUnavailable(res, error, code = 'WALLET_OWNERSHIP_UNAVAILABLE') {
  if (error) {
    console.warn('Wallet ownership service unavailable:', error.message);
  }
  return res.status(503).json({
    error: 'Wallet ownership service is temporarily unavailable',
    code,
    retryable: true,
  });
}

/**
 * Bind a wallet address to an auth user in the database.
 */
async function bindWalletToUser(authUserId, walletAddress) {
  if (!isSupabasePersistenceEnabled()) {
    if (config.authRequired) {
      throw new Error('Wallet persistence is required when authentication is enabled');
    }
    return;
  }

  try {
    await supabaseRestRequest('wallet_bindings', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
      auth_user_id: authUserId,
      wallet_address: walletAddress,
      is_active: true,
      }),
    });
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) throw error;
    const owner = await resolveWalletOwner(walletAddress);
    if (owner.ok && owner.owner === authUserId) return;
    if (owner.ok && owner.owner) {
      throw Object.assign(new Error('Wallet is already bound to another user'), {
        statusCode: 403,
        code: 'WALLET_OWNERSHIP_DENIED',
        expose: true,
      });
    }
    throw error;
  }
}

/**
 * Build a middleware that verifies the requesting user owns the wallet
 * identified by `walletField` in req.body.
 *
 * Only explicit auth-disabled development may skip this check. Authenticated
 * deployments reject requests when persistence is unavailable or errors.
 *
 * @param {string} walletField - The req.body key that holds the wallet address.
 */
function preparedAccountTransactionKey(authUid, transactionHash) {
  return `${authUid}:${transactionHash}`;
}

function serializeDecoratedSignature(signature) {
  return Buffer.from(signature.toXDR()).toString('base64');
}

function prunePreparedAccountTransactions(now = Date.now()) {
  for (const [key, prepared] of Object.entries(preparedAccountTransactions)) {
    if (prepared.expiresAt <= now) {
      delete preparedAccountTransactions[key];
    }
  }

  const keys = Object.keys(preparedAccountTransactions);
  if (keys.length > MAX_PREPARED_ACCOUNT_TRANSACTIONS) {
    const excess = keys.length - MAX_PREPARED_ACCOUNT_TRANSACTIONS;
    for (let i = 0; i < excess; i++) {
      delete preparedAccountTransactions[keys[i]];
    }
  }
}

function rememberPreparedAccountTransaction(authUid, transaction) {
  const firstSignature = transaction.signatures[0];
  const sponsorSignature = firstSignature && serializeDecoratedSignature(firstSignature);
  if (!sponsorSignature) {
    throw new Error('Prepared account transaction is missing the sponsor signature');
  }

  const transactionHash = transaction.hash().toString('hex');
  const key = preparedAccountTransactionKey(authUid, transactionHash);
  const now = Date.now();
  prunePreparedAccountTransactions(now);
  preparedAccountTransactions[key] = {
    key,
    expiresAt: now + PREPARED_ACCOUNT_TRANSACTION_TTL_MS,
    sponsorSignature,
    inFlight: false,
  };
  prunePreparedAccountTransactions(now);
}

function getPreparedAccountTransaction(authUid, transaction) {
  prunePreparedAccountTransactions();
  const transactionHash = transaction.hash().toString('hex');
  const key = preparedAccountTransactionKey(authUid, transactionHash);
  const prepared = preparedAccountTransactions[key];
  if (!prepared) return null;

  const hasUnchangedSponsorSignature = transaction.signatures.some(signature => {
    try {
      return serializeDecoratedSignature(signature) === prepared.sponsorSignature;
    } catch {
      return false;
    }
  });
  return hasUnchangedSponsorSignature ? prepared : null;
}

function requireWalletOwnership(walletField) {
  return async function (req, res, next) {
    if (!config.authRequired) {
      return next();
    }

    const authUid = req.auth && req.auth.sub;
    if (!authUid) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    const ownershipResult = await resolveUserWallets(authUid);
    if (!ownershipResult.configured || !ownershipResult.ok) {
      return sendWalletOwnershipUnavailable(res, ownershipResult.error);
    }
    const ownedWallets = ownershipResult.wallets;

    if (ownedWallets.length === 0) {
      // If we are preparing an account, it might not be bound yet.
      // But we already added the binding to /accounts/prepare.
      return res.status(403).json({
        error: 'No wallets bound to this user',
        code: 'NO_WALLETS_BOUND',
      });
    }

    if (walletField) {
      const requestedWallet = req.body && req.body[walletField];
      if (requestedWallet) {
        if (!ownedWallets.includes(requestedWallet)) {
          return res.status(403).json({
            error: 'You are not authorized to perform actions for this wallet',
            code: 'WALLET_OWNERSHIP_DENIED',
          });
        }
      } else {
        // Resolve wallet from binding rather than trusting body
        req.body[walletField] = ownedWallets[0];
      }
    } else {
      req.resolvedWallets = ownedWallets;
    }

    return next();
  };
}

/** Verify that an authenticated user owns the wallet in a route parameter. */
function requirePathWalletOwnership() {
  return async function (req, res, next) {
    if (!config.authRequired) return next();
    const authUid = req.auth && req.auth.sub;
    if (!authUid) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }
    const ownershipResult = await resolveUserWallets(authUid);
    if (!ownershipResult.configured || !ownershipResult.ok) {
      return sendWalletOwnershipUnavailable(res, ownershipResult.error);
    }
    const ownedWallets = ownershipResult.wallets;
    const requestedWallet = req.params.accountId;
    if (!ownedWallets.includes(requestedWallet)) {
      return res.status(403).json({
        error: 'You are not authorized to view this wallet',
        code: 'WALLET_OWNERSHIP_DENIED',
      });
    }
    return next();
  };
}

/**
 * Middleware for /accounts/prepare.
 * Enforces wallet ownership, uniqueness (cannot prepare wallet bound to another user),
 * per-user sponsorship limits, and durable blocking binding.
 */
function requireAccountPreparationOwnership(walletField = 'accountId') {
  return async function (req, res, next) {
    let accountId;
    try {
      accountId = assertAccountId(req.body && req.body[walletField], walletField);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    if (!config.authRequired) {
      return next();
    }

    const authUid = req.auth && req.auth.sub;
    if (!authUid) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    const ownerResult = await resolveWalletOwner(accountId);
    if (!ownerResult.configured || !ownerResult.ok) {
      return sendWalletOwnershipUnavailable(res, ownerResult.error);
    }

    if (ownerResult.owner && ownerResult.owner !== authUid) {
      return res.status(403).json({
        error: 'You are not authorized to prepare this wallet (already bound to another user)',
        code: 'WALLET_OWNERSHIP_DENIED',
      });
    }

    if (!ownerResult.owner) {
      const walletsResult = await resolveUserWallets(authUid);
      if (!walletsResult.configured || !walletsResult.ok) {
        return sendWalletOwnershipUnavailable(res, walletsResult.error);
      }

      if (walletsResult.wallets.length >= config.maxSponsoredAccountsPerUser) {
        return res.status(403).json({
          error: `Maximum sponsored accounts limit (${config.maxSponsoredAccountsPerUser}) reached for this user`,
          code: 'SPONSORSHIP_LIMIT_EXCEEDED',
          maxAccounts: config.maxSponsoredAccountsPerUser,
        });
      }

      try {
        await bindWalletToUser(authUid, accountId);
      } catch (error) {
        if (error.statusCode === 403) {
          return res.status(403).json({ error: error.message, code: error.code });
        }
        console.error('Failed to bind wallet:', error.message);
        return sendWalletOwnershipUnavailable(res, error, 'WALLET_BINDING_FAILED');
      }
    }

    return next();
  };
}

/**
 * Public-network reserve sponsorship must always be attributable to an
 * authenticated user. Development may leave auth off for testnet only.
 */
function rejectUnauthenticatedPublicSponsorship(req, res, next) {
  if (config.networkName === 'public' && !config.authRequired) {
    return res.status(403).json({
      error: 'Account sponsorship requires authentication on the public network',
      code: 'PUBLIC_NETWORK_AUTH_REQUIRED',
    });
  }
  return next();
}

async function verifySupabaseJwt(authorizationHeader) {
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error('Authentication required');
  }

  const token = match[1];
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Invalid authentication token');
  }

  const header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
  if (header.alg !== 'HS256' || !config.supabaseJwtSecret) {
    return verifySupabaseTokenWithAuthApi(token);
  }

  const signedPayload = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac('sha256', config.supabaseJwtSecret)
    .update(signedPayload)
    .digest();
  const actualSignature = base64UrlDecode(encodedSignature);

  if (
    actualSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error('Invalid authentication token');
  }

  const claims = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!claims.sub || (claims.exp && claims.exp <= nowSeconds)) {
    throw new Error('Expired authentication token');
  }

  if (claims.role && claims.role !== 'authenticated') {
    throw new Error('Authenticated user token required');
  }

  return claims;
}

async function verifySupabaseTokenWithAuthApi(token) {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Unsupported authentication token. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or set RELAYER_AUTH_REQUIRED=false for MVP testing.');
  }

  const response = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${token}`,
    },
  });
  const user = await response.json().catch(() => ({}));

  if (!response.ok || !user?.id) {
    throw new Error(user?.msg || user?.message || 'Invalid authentication token');
  }

  return {
    sub: user.id,
    role: 'authenticated',
    email: user.email,
    aud: user.aud,
  };
}

function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function assertAccountId(value, label) {
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(value || '')) {
    const error = new Error(`Invalid Stellar ${label}`);
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }
  return value;
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

  const candidates = [trimmed];

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    candidates.push(Buffer.from(trimmed, 'hex').toString('base64'));
  }

  if (/^\d+(,\d+)+$/.test(trimmed)) {
    const bytes = trimmed.split(',').map(item => Number(item));
    const validBytes = bytes.every(item => Number.isInteger(item) && item >= 0 && item <= 255);
    if (validBytes) {
      candidates.push(Buffer.from(bytes).toString('base64'));
    }
  }

  for (const candidate of candidates) {
    if (isTransactionEnvelopeXdr(candidate)) {
      return candidate;
    }
  }

  const error = new Error('Invalid transaction XDR');
  error.statusCode = 400;
  error.expose = true;
  throw error;
}

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

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
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
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > maxAmount) {
    const error = new Error(`Amount must be greater than 0 and no more than ${maxAmount}`);
    error.statusCode = 400;
    error.expose = true;
    if (numeric > maxAmount) {
      error.code = 'PAYMENT_AMOUNT_EXCEEDED';
    }
    throw error;
  }

  return amount;
}

async function getBalances(accountId) {
  try {
    const account = await server.loadAccount(accountId);
    const xlm = account.balances.find(balance => balance.asset_type === 'native')?.balance || '0';
    const asset = account.balances.find(balance =>
      balance.asset_code === config.assetCode &&
      balance.asset_issuer === config.assetIssuer
    )?.balance || '0';

    return { xlm, asset };
  } catch (error) {
    if (error?.response?.status === 404) {
      return { xlm: '0', asset: '0' };
    }
    throw error;
  }
}

async function getAccountStatus(accountId) {
  try {
    const account = await server.loadAccount(accountId);
    const hasTrustline = account.balances.some(balance =>
      balance.asset_code === config.assetCode &&
      balance.asset_issuer === config.assetIssuer
    );

    return {
      accountId,
      exists: true,
      hasTrustline,
      sequence: account.sequence,
    };
  } catch (error) {
    if (error?.response?.status === 404) {
      return {
        accountId,
        exists: false,
        hasTrustline: false,
      };
    }
    throw error;
  }
}

/**
 * In-memory fallback lock for Add Money claims when Supabase is not configured.
 * Eviction policy:
 * - TTL: Lock TTL (transactionTimeoutSeconds * 1000 + 5000).
 * - Capacity: Max 1,000 concurrent user locks (MAX_ACTIVE_ADD_MONEY_USER_LOCKS).
 * - Eviction: Expired entries are pruned on every acquisition; oldest entries evicted if capacity exceeded.
 */
const MAX_ACTIVE_ADD_MONEY_USER_LOCKS = 1000;
const activeAddMoneyUserLocks = Object.create(null);

function pruneActiveAddMoneyUserLocks(now = Date.now()) {
  for (const [key, expiry] of Object.entries(activeAddMoneyUserLocks)) {
    if (expiry <= now) {
      delete activeAddMoneyUserLocks[key];
    }
  }
  const keys = Object.keys(activeAddMoneyUserLocks);
  if (keys.length > MAX_ACTIVE_ADD_MONEY_USER_LOCKS) {
    const excess = keys.length - MAX_ACTIVE_ADD_MONEY_USER_LOCKS;
    for (let i = 0; i < excess; i++) {
      delete activeAddMoneyUserLocks[keys[i]];
    }
  }
}

async function acquireAddMoneyUserLock(userLockKey, ttlMs) {
  const now = Date.now();

  // If Supabase persistence is enabled, the database is the distributed authority across instances.
  if (isSupabasePersistenceEnabled()) {
    try {
      await supabaseRestRequest('relayer_idempotency_keys', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          key: userLockKey,
          response: null,
          expires_at: new Date(now + ttlMs).toISOString(),
        }),
      });
      activeAddMoneyUserLocks[userLockKey] = now + ttlMs;
      pruneActiveAddMoneyUserLocks(now);
      return { acquired: true };
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        // A failed database insert must never leave a local entry looking held.
        delete activeAddMoneyUserLocks[userLockKey];
        // Lock already held by this or another instance. Check for expiry.
        try {
          const query = new URLSearchParams({ select: 'expires_at', key: `eq.${userLockKey}`, limit: '1' });
          const rows = await supabaseRestRequest(`relayer_idempotency_keys?${query.toString()}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (Array.isArray(rows) && rows.length > 0 && rows[0].expires_at) {
            const expiresAt = new Date(rows[0].expires_at).getTime();
            if (expiresAt <= now) {
              // Lock expired: renew it and acquire
              const patchQuery = new URLSearchParams({ key: `eq.${userLockKey}` });
              await supabaseRestRequest(`relayer_idempotency_keys?${patchQuery.toString()}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({
                  expires_at: new Date(now + ttlMs).toISOString(),
                }),
              });
              activeAddMoneyUserLocks[userLockKey] = now + ttlMs;
              pruneActiveAddMoneyUserLocks(now);
              return { acquired: true };
            }
          }
        } catch {}
        return { acquired: false };
      }
      delete activeAddMoneyUserLocks[userLockKey];
      throw createAddMoneyPersistenceError(error, 'lock acquisition');
    }
  }

  // Fallback when Supabase persistence is not configured
  pruneActiveAddMoneyUserLocks(now);
  const existingExpiry = activeAddMoneyUserLocks[userLockKey];
  if (existingExpiry && existingExpiry > now) {
    return { acquired: false };
  }
  activeAddMoneyUserLocks[userLockKey] = now + ttlMs;
  return { acquired: true };
}

async function releaseAddMoneyUserLock(userLockKey) {
  delete activeAddMoneyUserLocks[userLockKey];
  if (isSupabasePersistenceEnabled()) {
    try {
      const query = new URLSearchParams({ key: `eq.${userLockKey}` });
      await supabaseRestRequest(`relayer_idempotency_keys?${query.toString()}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } catch {
      // Best-effort cleanup
    }
  }
}

async function getAddMoneyRetryAfterSeconds(accountId, authUserId) {
  const persistedRetryAfter = await getPersistedAddMoneyRetryAfterSeconds(accountId, authUserId);
  return persistedRetryAfter;
}

async function getPersistedAddMoneyRetryAfterSeconds(accountId, authUserId) {
  if (!isSupabasePersistenceEnabled()) {
    throw createAddMoneyPersistenceError(
      new Error('Supabase persistence is not configured'),
      'cooldown lookup'
    );
  }

  try {
    let filter;
    if (authUserId) {
      filter = `or=(auth_user_id.eq.${encodeURIComponent(authUserId)},wallet_address.eq.${encodeURIComponent(accountId)})`;
    } else {
      filter = `wallet_address=eq.${encodeURIComponent(accountId)}`;
    }

    const query = new URLSearchParams({
      select: 'next_available_at',
      next_available_at: `gt.${new Date().toISOString()}`,
      order: 'next_available_at.desc',
      limit: '1',
    });

    const rows = await supabaseRestRequest(`add_money_claims?${filter}&${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!Array.isArray(rows)) {
      throw new Error('Cooldown lookup returned an invalid response');
    }
    const nextAvailableAt = rows[0]?.next_available_at;
    if (!nextAvailableAt) {
      return 0;
    }

    const remainingMs = new Date(nextAvailableAt).getTime() - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  } catch (error) {
    throw createAddMoneyPersistenceError(error, 'cooldown lookup');
  }
}

async function checkAddMoneyDailyCap(accountId, authUserId, requestedAmount) {
  if (!isSupabasePersistenceEnabled()) {
    throw createAddMoneyPersistenceError(
      new Error('Supabase persistence is not configured'),
      'daily cap lookup'
    );
  }
  if (!config.maxAddMoneyDailyCap) {
    return { allowed: true, totalClaimed: 0, retryAfterSeconds: 0 };
  }

  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let filter;
    if (authUserId) {
      filter = `or=(auth_user_id.eq.${encodeURIComponent(authUserId)},wallet_address.eq.${encodeURIComponent(accountId)})`;
    } else {
      filter = `wallet_address=eq.${encodeURIComponent(accountId)}`;
    }

    const query = new URLSearchParams({
      select: 'amount,claimed_at',
      claimed_at: `gte.${oneDayAgo}`,
      order: 'claimed_at.asc',
    });

    const rows = await supabaseRestRequest(`add_money_claims?${filter}&${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!Array.isArray(rows)) {
      throw new Error('Daily cap lookup returned an invalid response');
    }
    if (rows.length === 0) {
      return { allowed: true, totalClaimed: 0, retryAfterSeconds: 0 };
    }

    const totalClaimed = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const numRequested = Number(requestedAmount || 0);

    if (totalClaimed + numRequested > config.maxAddMoneyDailyCap) {
      const oldestClaimTime = new Date(rows[0].claimed_at).getTime();
      const resetTime = oldestClaimTime + 24 * 60 * 60 * 1000;
      const remainingMs = resetTime - Date.now();
      const retryAfterSeconds = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 3600;

      return {
        allowed: false,
        totalClaimed,
        retryAfterSeconds,
      };
    }

    return { allowed: true, totalClaimed, retryAfterSeconds: 0 };
  } catch (error) {
    throw createAddMoneyPersistenceError(error, 'daily cap lookup');
  }
}

async function reserveAddMoneyClaim({
  claimId,
  walletAddress,
  authUserId,
  amount,
  idempotencyKey,
  nextAvailableAt,
}) {
  if (!isSupabasePersistenceEnabled()) {
    throw createAddMoneyPersistenceError(
      new Error('Supabase persistence is not configured'),
      'claim reservation'
    );
  }

  try {
    const row = {
      id: claimId,
      wallet_address: walletAddress,
      auth_user_id: authUserId || null,
      amount,
      asset_code: config.assetCode,
      asset_issuer: config.assetIssuer,
      tx_hash: null,
      idempotency_key: idempotencyKey || null,
      claimed_at: new Date().toISOString(),
      next_available_at: nextAvailableAt,
    };

    const rows = await supabaseRestRequest('add_money_claims', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== claimId) {
      throw new Error('Claim reservation returned an invalid response');
    }
  } catch (error) {
    throw createAddMoneyPersistenceError(error, 'claim reservation');
  }
}

async function settleAddMoneyClaim(claimId, txHash) {
  try {
    const query = new URLSearchParams({ id: `eq.${claimId}` });
    const rows = await supabaseRestRequest(`add_money_claims?${query.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ tx_hash: txHash }),
    });
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== claimId) {
      throw new Error('Claim settlement did not update the reserved claim');
    }
  } catch (error) {
    throw createAddMoneyPersistenceError(error, 'claim settlement');
  }
}

function createAddMoneyPersistenceError(cause, operation) {
  if (cause?.code === 'ADD_MONEY_PERSISTENCE_UNAVAILABLE') {
    return cause;
  }
  const error = new Error(`Add Money ${operation} is temporarily unavailable`);
  error.statusCode = 503;
  error.expose = true;
  error.code = 'ADD_MONEY_PERSISTENCE_UNAVAILABLE';
  error.retryable = true;
  error.cause = cause;
  return error;
}

function isSupabasePersistenceEnabled() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

// ── Persisted idempotency ──────────────────────────────────────────────

async function acquireIdempotencyLock(key, ttlMs) {
  if (!isSupabasePersistenceEnabled()) {
    return { acquired: true };
  }
  try {
    await supabaseRestRequest('relayer_idempotency_keys', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        key,
        response: null,
        expires_at: new Date(Date.now() + ttlMs).toISOString(),
      }),
    });
    return { acquired: true };
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      const query = new URLSearchParams({ select: 'response', key: `eq.${key}`, limit: '1' });
      const rows = await supabaseRestRequest(`relayer_idempotency_keys?${query.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (Array.isArray(rows) && rows.length > 0) {
        return { acquired: false, response: rows[0].response };
      }
    }
    throw error;
  }
}

async function acquireClientIdempotencyLock(authUserId, key, requestBody, ttlMs) {
  if (!authUserId) throw Object.assign(new Error('Authenticated user is required for idempotency'), { statusCode: 401, expose: true });
  const requestHash = crypto.createHash('sha256').update(requestBody).digest('hex');
  if (!isSupabasePersistenceEnabled()) return { acquired: true, requestHash };
  const record = { auth_user_id: authUserId, key, request_hash: requestHash, response: null, expires_at: new Date(Date.now() + ttlMs).toISOString() };
  try {
    await supabaseRestRequest('relayer_client_idempotency_keys', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(record) });
    return { acquired: true, requestHash };
  } catch (error) {
    if (!isPostgresUniqueViolation(error)) throw error;
    const query = new URLSearchParams({ select: 'request_hash,response', auth_user_id: `eq.${authUserId}`, key: `eq.${key}`, limit: '1' });
    const rows = await supabaseRestRequest(`relayer_client_idempotency_keys?${query}`, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!rows?.length) throw error;
    if (rows[0].request_hash !== requestHash) return { acquired: false, mismatch: true };
    return { acquired: false, response: rows[0].response };
  }
}

async function setClientIdempotencyResponse(authUserId, key, response) {
  if (!isSupabasePersistenceEnabled()) return;
  const query = new URLSearchParams({ auth_user_id: `eq.${authUserId}`, key: `eq.${key}` });
  await supabaseRestRequest(`relayer_client_idempotency_keys?${query}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ response }) });
}

async function releaseClientIdempotencyLock(authUserId, key) {
  if (!isSupabasePersistenceEnabled() || !authUserId) return;
  const query = new URLSearchParams({ auth_user_id: `eq.${authUserId}`, key: `eq.${key}`, response: 'is.null' });
  await supabaseRestRequest(`relayer_client_idempotency_keys?${query}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

async function setIdempotencyResponse(key, response, ttlMs) {
  if (!isSupabasePersistenceEnabled()) {
    return;
  }
  try {
    const query = new URLSearchParams({ key: `eq.${key}` });
    await supabaseRestRequest(`relayer_idempotency_keys?${query.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ response }),
    });
  } catch (error) {
    console.warn('Idempotency update failed:', error.message);
  }
}

async function getPaymentRecords(accountId, authUserId, sinceIso) {
  if (!isSupabasePersistenceEnabled()) {
    return inMemoryPaymentRecords.filter(r => {
      const matchUser = (authUserId && r.auth_user_id === authUserId) || (accountId && r.wallet_address === accountId);
      const matchTime = !sinceIso || new Date(r.created_at) >= new Date(sinceIso);
      return matchUser && matchTime;
    });
  }

  let filter;
  if (authUserId) {
    filter = accountId
      ? `or=(auth_user_id.eq.${encodeURIComponent(authUserId)},wallet_address.eq.${encodeURIComponent(accountId)})`
      : `auth_user_id=eq.${encodeURIComponent(authUserId)}`;
  } else {
    filter = `wallet_address=eq.${encodeURIComponent(accountId)}`;
  }

  const query = new URLSearchParams({
    select: 'amount,created_at',
    order: 'created_at.asc',
  });
  if (sinceIso) {
    query.set('created_at', `gte.${sinceIso}`);
  }

  const rows = await supabaseRestRequest(`payment_records?${filter}&${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!Array.isArray(rows)) {
    throw new Error('Payment limits lookup returned an invalid response');
  }

  return rows;
}

async function recordPaymentRecord({ id, authUserId, walletAddress, amount, txHash }) {
  const row = {
    id: id || crypto.randomUUID(),
    auth_user_id: authUserId || null,
    wallet_address: walletAddress,
    amount,
    tx_hash: txHash || null,
    created_at: new Date().toISOString(),
  };

  inMemoryPaymentRecords.push(row);

  if (!isSupabasePersistenceEnabled()) {
    return row;
  }

  try {
    const rows = await supabaseRestRequest('payment_records', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    return (Array.isArray(rows) && rows[0]) || row;
  } catch (error) {
    console.error('Failed to persist payment limits record:', error.message);
    throw error;
  }
}

async function checkPaymentLimits(walletAddress, authUserId, amountStr) {
  const amountNum = Number(amountStr);

  if (amountNum > config.maxPaymentAmount) {
    const error = new Error(`Payment amount exceeds the maximum per-transaction limit of ${config.maxPaymentAmount} ${config.assetCode}`);
    error.statusCode = 400;
    error.expose = true;
    error.code = 'PAYMENT_AMOUNT_EXCEEDED';
    throw error;
  }

  const now = Date.now();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  let records;
  try {
    records = await getPaymentRecords(walletAddress, authUserId, oneDayAgo);
  } catch (err) {
    const error = new Error('Payment limits service is temporarily unavailable');
    error.statusCode = 503;
    error.expose = true;
    error.code = 'PAYMENT_LIMITS_UNAVAILABLE';
    error.retryable = true;
    throw error;
  }

  // Velocity limit: payments within the last 60 seconds
  const recentRecords = records.filter(r => new Date(r.created_at).getTime() >= (now - 60 * 1000));
  if (recentRecords.length >= config.maxPaymentVelocityPerMinute) {
    const oldestRecent = Math.min(...recentRecords.map(r => new Date(r.created_at).getTime()));
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestRecent + 60 * 1000 - now) / 1000));
    const error = new Error(`Payment velocity limit reached (${config.maxPaymentVelocityPerMinute} per minute). Please wait ${retryAfterSeconds} seconds.`);
    error.statusCode = 429;
    error.expose = true;
    error.code = 'PAYMENT_VELOCITY_EXCEEDED';
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }

  // Daily transaction count limit
  if (records.length >= config.maxPaymentDailyCount) {
    const oldestInDay = new Date(records[0].created_at).getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestInDay + 24 * 60 * 60 * 1000 - now) / 1000));
    const error = new Error(`Daily payment transaction limit reached (${config.maxPaymentDailyCount} transactions per day). Please try again later.`);
    error.statusCode = 429;
    error.expose = true;
    error.code = 'PAYMENT_DAILY_COUNT_EXCEEDED';
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }

  // Daily amount limit
  const totalAmountToday = records.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  if (totalAmountToday + amountNum > config.maxPaymentDailyAmount) {
    const oldestInDay = new Date(records[0].created_at).getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil((oldestInDay + 24 * 60 * 60 * 1000 - now) / 1000));
    const error = new Error(`Daily payment amount limit reached. Maximum ${config.maxPaymentDailyAmount} ${config.assetCode} per day.`);
    error.statusCode = 429;
    error.expose = true;
    error.code = 'PAYMENT_DAILY_CAP_EXCEEDED';
    error.retryAfterSeconds = retryAfterSeconds;
    error.details = {
      dailyCap: config.maxPaymentDailyAmount,
      totalToday: totalAmountToday,
      requested: amountNum,
    };
    throw error;
  }

  return { allowed: true };
}

async function getPaymentLimitsStatus(authUserId, walletAddress) {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const records = await getPaymentRecords(walletAddress, authUserId, oneDayAgo);

  const transactionsToday = records.length;
  const amountToday = records.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return {
    maxAmountPerTransaction: config.maxPaymentAmount,
    maxDailyAmount: config.maxPaymentDailyAmount,
    maxTransactionsPerDay: config.maxPaymentDailyCount,
    maxDailyCount: config.maxPaymentDailyCount,
    maxRequestsPerMinute: config.maxPaymentVelocityPerMinute,
    amountToday,
    transactionsToday,
    remaining: {
      amount: Math.max(0, config.maxPaymentDailyAmount - amountToday),
      transactions: Math.max(0, config.maxPaymentDailyCount - transactionsToday),
    },
  };
}

// ── Startup cleanup of expired persisted state ──────────────────────────────

async function cleanExpiredPersistedState() {
  if (!isSupabasePersistenceEnabled()) return;
  try {
    const now = new Date().toISOString();
    await supabaseRestRequest(`relayer_idempotency_keys?expires_at=lte.${encodeURIComponent(now)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    await supabaseRestRequest(`relayer_client_idempotency_keys?expires_at=lte.${encodeURIComponent(now)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    });
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabaseRestRequest(`payment_records?created_at=lte.${encodeURIComponent(sevenDaysAgo)}`, {
      method: 'DELETE',
      headers: { Prefer: 'return=minimal' },
    }).catch(() => {});
    console.log('Expired persisted state cleaned up on startup');
  } catch (error) {
    console.error('Failed to clean expired persisted state:', error.message);
  }
}

async function assertWalletBindingsReachable() {
  if (!isSupabasePersistenceEnabled()) {
    throw new Error('wallet_bindings requires configured Supabase persistence');
  }

  const rows = await supabaseRestRequest('wallet_bindings?select=id&limit=1', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!Array.isArray(rows)) {
    throw new Error('wallet_bindings startup probe returned an invalid response');
  }
}

async function supabaseRestRequest(path, options = {}) {
  return executeSupabaseRequest({
    baseUrl: config.supabaseUrl,
    serviceRoleKey: config.supabaseServiceRoleKey,
    path,
    options,
    fetchFn: typeof fetch === 'function' ? fetch : undefined,
  });
}

function getStellarErrorMessage(resultCodes) {
  const operations = resultCodes?.operations || [];

  if (operations.includes('op_no_issuer')) {
    return `Circle's ${config.assetCode} issuer is unavailable on ${config.networkName}. Verify the network and issuer configuration.`;
  }

  if (operations.includes('op_no_trust')) {
    return `${config.assetCode} trustline setup is missing or incomplete. Please try Add Money again.`;
  }

  if (operations.includes('op_underfunded')) {
    return 'The sponsor account does not have enough XLM to prepare this wallet.';
  }

  if (operations.includes('op_already_exists')) {
    return 'This wallet setup is already confirmed. Please try Add Money again.';
  }

  if (resultCodes?.transaction === 'tx_bad_seq') {
    return 'The relayer sequence was used by another request. Please try again.';
  }

  if (resultCodes?.transaction === 'tx_bad_auth' || resultCodes?.transaction === 'tx_bad_auth_extra') {
    return 'Wallet setup signature was rejected. Please unlock the correct wallet and try again.';
  }

  return '';
}

function validatePaymentTransaction(transaction) {
  if (!transaction.source) {
    const error = new Error('Transaction source is required');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  if (transaction.operations.length !== 1) {
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
  normalizeAmount(operation.amount, config.maxPaymentAmount);

  if (
    operation.asset.code !== config.assetCode ||
    operation.asset.issuer !== config.assetIssuer
  ) {
    const error = new Error('Payment asset is not supported');
    error.statusCode = 400;
    error.expose = true;
    throw error;
  }

  return {
    source: transaction.source,
    destination: operation.destination,
    amount: operation.amount,
  };
}

async function sendLowBalanceAlert({ sponsorXlm, distributionAsset, lowXlm, lowAsset }) {
  if (!process.env.ALERT_WEBHOOK_URL) {
    return;
  }

  const warnings = [
    lowXlm ? `Sponsor XLM balance is ${sponsorXlm}` : null,
    lowAsset ? `Distribution USDC balance is ${distributionAsset}` : null,
  ].filter(Boolean);

  await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service: 'cpay-stellar-relayer',
      network: config.networkName,
      warnings,
      sponsorPublicKey: sponsorSigner.publicKey(),
      distributionPublicKey: distributionSigner.publicKey(),
      timestamp: new Date().toISOString(),
    }),
  });
}

async function checkLowBalanceAlerts() {
  const [sponsorBalances, distributionBalances] = await Promise.all([
    getBalances(sponsorSigner.publicKey()),
    getBalances(distributionSigner.publicKey()),
  ]);
  const sponsorXlm = Number(sponsorBalances.xlm || '0');
  const distributionAsset = Number(distributionBalances.asset || '0');
  const lowXlm = sponsorXlm < config.lowXlmThreshold;
  const lowAsset = distributionAsset < config.lowAssetThreshold;

  if (lowXlm || lowAsset) {
    if (await shouldSendLowBalanceAlert()) {
      await sendLowBalanceAlert({ sponsorXlm, distributionAsset, lowXlm, lowAsset });
    }
  } else {
    await resetLowBalanceAlert();
  }
}

const LOW_BALANCE_ALERT_KEY = 'alert:low-balance';

async function shouldSendLowBalanceAlert() {
  const now = Date.now();
  if (isSupabasePersistenceEnabled()) {
    try {
      const expiresAt = new Date(now + LOW_BALANCE_ALERT_WINDOW_MS).toISOString();
      await supabaseRestRequest('relayer_idempotency_keys', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          key: LOW_BALANCE_ALERT_KEY,
          response: { alertedAt: new Date(now).toISOString() },
          expires_at: expiresAt,
        }),
      });
      localLowBalanceAlertUntil = now + LOW_BALANCE_ALERT_WINDOW_MS;
      return true;
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        try {
          const query = new URLSearchParams({ select: 'expires_at', key: `eq.${LOW_BALANCE_ALERT_KEY}`, limit: '1' });
          const rows = await supabaseRestRequest(`relayer_idempotency_keys?${query.toString()}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });
          if (Array.isArray(rows) && rows.length > 0 && rows[0].expires_at) {
            const exp = new Date(rows[0].expires_at).getTime();
            if (exp <= now) {
              const patchQuery = new URLSearchParams({ key: `eq.${LOW_BALANCE_ALERT_KEY}` });
              await supabaseRestRequest(`relayer_idempotency_keys?${patchQuery.toString()}`, {
                method: 'PATCH',
                headers: { Prefer: 'return=minimal' },
                body: JSON.stringify({
                  expires_at: new Date(now + LOW_BALANCE_ALERT_WINDOW_MS).toISOString(),
                  response: { alertedAt: new Date(now).toISOString() },
                }),
              });
              localLowBalanceAlertUntil = now + LOW_BALANCE_ALERT_WINDOW_MS;
              return true;
            }
          }
        } catch {}
        return false;
      }
    }
  }

  if (localLowBalanceAlertUntil > now) {
    return false;
  }
  localLowBalanceAlertUntil = now + LOW_BALANCE_ALERT_WINDOW_MS;
  return true;
}

async function resetLowBalanceAlert() {
  localLowBalanceAlertUntil = 0;
  if (isSupabasePersistenceEnabled()) {
    try {
      const query = new URLSearchParams({ key: `eq.${LOW_BALANCE_ALERT_KEY}` });
      await supabaseRestRequest(`relayer_idempotency_keys?${query.toString()}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
    } catch {}
  }
}

module.exports = {
  app,
  get server() {
    return relayerHttpServer;
  },
  startupPromise,
  ingestWorker,
  keyManager,
  SupabaseRequestError,
  ...(process.env.NODE_ENV === 'test' ? {
    testHooks: Object.freeze({
      keyManager,
      stellarServer: server,
      acquireAddMoneyUserLock,
      releaseAddMoneyUserLock,
      acquireIdempotencyLock,
      getAddMoneyRetryAfterSeconds,
      checkAddMoneyDailyCap,
      reserveAddMoneyClaim,
      settleAddMoneyClaim,
      supabaseRestRequest,
      SupabaseRequestError,
      isPostgresUniqueViolation,
      checkPaymentLimits,
      getPaymentLimitsStatus,
      recordPaymentRecord,
      inMemoryPaymentRecords,
      shouldSendLowBalanceAlert,
      resetLowBalanceAlert,
      checkLowBalanceAlerts,
      handleRelayerError,
      getHorizonTransactionResultCodes,
      preparedAccountTransactions,
      prunePreparedAccountTransactions,
      activeAddMoneyUserLocks,
      pruneActiveAddMoneyUserLocks,
      requireAccountPreparationOwnership,
      rejectUnauthenticatedPublicSponsorship,
    }),
  } : {}),
};
