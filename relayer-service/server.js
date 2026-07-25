require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const StellarSdk = require('@stellar/stellar-sdk');
const { buildTrustedTransactionRow } = require('./receiptPersistence');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const NETWORKS = {
  testnet: {
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: StellarSdk.Networks.TESTNET,
    friendbotUrl: 'https://friendbot.stellar.org',
  },
  public: {
    horizonUrl: 'https://horizon.stellar.org',
    passphrase: StellarSdk.Networks.PUBLIC,
    friendbotUrl: null,
  },
};

const config = loadConfig();
const server = new StellarSdk.Horizon.Server(config.horizonUrl, {
  allowHttp: config.horizonUrl.startsWith('http://'),
});
const sponsorKeypair = StellarSdk.Keypair.fromSecret(config.sponsorSecret);
const distributionKeypair = StellarSdk.Keypair.fromSecret(config.distributionSecret);
const relayerContractKeypair = config.relayerSecret
  ? StellarSdk.Keypair.fromSecret(config.relayerSecret)
  : null;
const contractAdminKeypair = config.contractAdminSecret
  ? StellarSdk.Keypair.fromSecret(config.contractAdminSecret)
  : null;
const cpinrAsset = new StellarSdk.Asset(config.assetCode, config.assetIssuer);
const sorobanServer = config.sorobanRpcUrl
  ? new StellarSdk.rpc.Server(config.sorobanRpcUrl, {
    allowHttp: config.sorobanRpcUrl.startsWith('http://'),
  })
  : null;
const cpayContract = config.cpayContractId
  ? new StellarSdk.Contract(config.cpayContractId)
  : null;
const idempotencyCache = new Map();
const addMoneyCooldowns = new Map();
const contractIntentCache = new Map();

let lowBalanceAlertSent = false;

app.use(helmet());
app.use(cors({ origin: parseCorsOrigin(process.env.CORS_ORIGIN || '*') }));
app.use(express.json({ limit: '64kb' }));

const limiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  max: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 100),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

app.use(limiter);

app.get('/', (_req, res) => {
  res.json({
    service: 'C-Pay Stellar Relayer',
    status: 'running',
    health: '/health',
    endpoints: [
      'GET /health',
      'GET /account/:accountId/status',
      'GET /account/:accountId/balance',
      'POST /accounts/prepare',
      'POST /accounts/submit',
      'POST /contract/merchants/register',
      'GET /contract/config',
      'POST /payments/intents/prepare',
      'POST /payments/intents/submit',
      'POST /payments/submit',
      'POST /add-money',
      'GET /tx/:hash',
    ],
  });
});

app.get('/health', async (_req, res) => {
  const [sponsorBalances, distributionBalances] = await Promise.all([
    getBalances(sponsorKeypair.publicKey()),
    getBalances(distributionKeypair.publicKey()),
  ]);

  const sponsorXlm = Number(sponsorBalances.xlm || '0');
  const distributionAsset = Number(distributionBalances.asset || '0');
  const lowXlm = sponsorXlm < config.lowXlmThreshold;
  const lowAsset = distributionAsset < config.lowAssetThreshold;

  if ((lowXlm || lowAsset) && !lowBalanceAlertSent) {
    await sendLowBalanceAlert({ sponsorXlm, distributionAsset, lowXlm, lowAsset });
    lowBalanceAlertSent = true;
  } else if (!lowXlm && !lowAsset) {
    lowBalanceAlertSent = false;
  }

  res.json({
    status: 'healthy',
    network: config.networkName,
    assetCode: config.assetCode,
    assetIssuer: config.assetIssuer,
    sponsorPublicKey: sponsorKeypair.publicKey(),
    distributionPublicKey: distributionKeypair.publicKey(),
    sponsorXlmBalance: sponsorBalances.xlm,
    distributionCpinrBalance: distributionBalances.asset,
    contractFlowEnabled: config.contractFlowEnabled,
    authRequired: config.authRequired,
    authApiConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
    legacyJwtSecretConfigured: Boolean(config.supabaseJwtSecret),
    supabasePersistenceEnabled: isSupabasePersistenceEnabled(),
    cpayContractId: config.cpayContractId,
    tokenContractId: config.tokenContractId,
    sorobanRpcUrl: config.sorobanRpcUrl,
    lowXlm,
    lowAsset,
    timestamp: new Date().toISOString(),
  });
});

app.get('/account/:accountId/status', async (req, res) => {
  const accountId = assertAccountId(req.params.accountId, 'accountId');
  const [status, retryAfterSeconds] = await Promise.all([
    getAccountStatus(accountId),
    getAddMoneyRetryAfterSeconds(accountId),
  ]);

  res.json({
    ...status,
    addMoneyReady: status.exists && status.hasTrustline,
    retryAfterSeconds,
  });
});

app.get('/account/:accountId/balance', async (req, res) => {
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

app.post('/accounts/prepare', requireAuthenticatedUser, async (req, res) => {
  const accountId = assertAccountId(req.body.accountId, 'accountId');
  const status = await getAccountStatus(accountId);

  if (status.exists && status.hasTrustline) {
    return res.json({
      alreadyReady: true,
      accountId,
      sponsorPublicKey: sponsorKeypair.publicKey(),
    });
  }

  const sponsorAccount = await server.loadAccount(sponsorKeypair.publicKey());
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
    asset: cpinrAsset,
    limit: config.trustlineLimit,
    source: accountId,
  }));

  builder.addOperation(StellarSdk.Operation.endSponsoringFutureReserves({
    source: accountId,
  }));

  const transaction = builder
    .setTimeout(config.transactionTimeoutSeconds)
    .build();
  transaction.sign(sponsorKeypair);

  res.json({
    alreadyReady: false,
    accountId,
    xdr: transaction.toXDR(),
    networkPassphrase: config.passphrase,
    sponsorPublicKey: sponsorKeypair.publicKey(),
    requiresAccountSignature: true,
  });
});

app.post('/accounts/submit', requireAuthenticatedUser, async (req, res) => {
  const signedXdr = assertTransactionEnvelopeXdr(req.body.signedXdr);
  const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, config.passphrase);
  const result = await server.submitTransaction(tx);

  res.json({
    hash: result.hash,
    ledger: result.ledger,
    status: 'success',
  });
});

app.get('/contract/config', async (_req, res) => {
  assertContractFlowEnabled();

  const contractConfig = await readContractConfig();
  res.json({
    ...contractConfig,
    contractId: config.cpayContractId,
    tokenContractId: config.tokenContractId,
    network: config.networkName,
  });
});

app.post('/contract/merchants/register', requireAuthenticatedUser, async (req, res) => {
  assertContractFlowEnabled();
  assertContractAdminConfigured();

  const merchantId = normalizeMerchantId(req.body.merchantId);
  const walletAddress = assertAccountId(req.body.walletAddress, 'walletAddress');
  const result = await registerMerchantOnContract(merchantId, walletAddress);

  res.json({
    status: 'success',
    merchantId,
    walletAddress,
    ...result,
  });
});

app.post('/payments/intents/prepare', requireAuthenticatedUser, async (req, res) => {
  assertContractFlowEnabled();

  const payer = assertAccountId(req.body.payer, 'payer');
  const merchantId = normalizeMerchantId(req.body.merchantId);
  const merchantAddress = assertAccountId(req.body.merchantAddress, 'merchantAddress');
  const amount = normalizeAmount(req.body.amount, config.maxPaymentAmount);
  const note = normalizeOptionalString(req.body.note).slice(0, 160);
  const amountUnits = amountToContractUnits(amount);
  const merchantKey = merchantIdToContractKeyHex(merchantId);
  const registeredMerchant = await readContractMerchantByKey(merchantKey);

  if (!registeredMerchant) {
    return res.status(409).json({
      error: 'Merchant is not registered on the C-Pay contract yet',
      code: 'CONTRACT_MERCHANT_MISSING',
    });
  }

  if (!registeredMerchant.active) {
    return res.status(409).json({
      error: 'Merchant is currently inactive on the C-Pay contract',
      code: 'CONTRACT_MERCHANT_INACTIVE',
    });
  }

  if (registeredMerchant.account !== merchantAddress) {
    return res.status(409).json({
      error: 'Merchant QR account does not match the contract registry',
      code: 'CONTRACT_MERCHANT_MISMATCH',
      registeredAccount: registeredMerchant.account,
    });
  }

  const intentId = crypto.randomBytes(32).toString('hex');
  const expiresAt = Math.floor(Date.now() / 1000) + config.contractIntentTtlSeconds;
  const memoHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      payer,
      merchantId,
      merchantAddress,
      amount,
      note,
      intentId,
    }))
    .digest('hex');

  const xdr = await prepareContractInvocation({
    sourceAccountId: payer,
    method: 'create_intent',
    args: [
      accountAddressScVal(payer),
      bytes32ScVal(merchantKey),
      bytes32ScVal(intentId),
      i128ScVal(amountUnits),
      u64ScVal(expiresAt),
      bytes32ScVal(memoHash),
    ],
  });

  const cachedIntent = {
    intentId,
    merchantId,
    merchantKey,
    merchantAddress,
    payer,
    amount,
    amountUnits: amountUnits.toString(),
    expiresAt,
    memoHash,
    status: 'prepared',
  };

  cacheContractIntent(intentId, cachedIntent);

  res.json({
    intentId,
    merchantId,
    merchantAddress,
    payer,
    amount,
    amountUnits: amountUnits.toString(),
    expiresAt,
    memoHash,
    xdr,
    networkPassphrase: config.passphrase,
    contractId: config.cpayContractId,
  });
});

app.post('/payments/intents/submit', requireAuthenticatedUser, async (req, res) => {
  assertContractFlowEnabled();

  const intentId = normalizeIntentId(req.body.intentId);
  const signedXdr = assertTransactionEnvelopeXdr(req.body.signedXdr);
  const transaction = StellarSdk.TransactionBuilder.fromXDR(signedXdr, config.passphrase);
  const cachedIntent = contractIntentCache.get(intentId);

  if (cachedIntent && transaction.source !== cachedIntent.payer) {
    return res.status(400).json({
      error: 'Signed payment intent source does not match the payer',
      code: 'CONTRACT_INTENT_SOURCE_MISMATCH',
    });
  }

  const result = await submitSignedSorobanTransaction(transaction);
  const createdIntent = {
    ...(cachedIntent || {}),
    intentId,
    status: 'created',
    createTxHash: result.hash,
    createLedger: result.ledger,
  };

  cacheContractIntent(intentId, createdIntent);

  res.json({
    status: 'success',
    intentId,
    hash: result.hash,
    ledger: result.ledger,
    contractId: config.cpayContractId,
  });
});

app.post('/payments/submit', requireAuthenticatedUser, async (req, res) => {
  const signedXdr = assertTransactionEnvelopeXdr(req.body.signedXdr);
  const idempotencyKey = normalizeOptionalString(req.body.idempotencyKey);
  const intentId = normalizeOptionalIntentId(req.body.intentId);

  if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
    return res.json(idempotencyCache.get(idempotencyKey));
  }

  const innerTransaction = StellarSdk.TransactionBuilder.fromXDR(signedXdr, config.passphrase);
  const payment = validatePaymentTransaction(innerTransaction);

  if (intentId) {
    assertContractFlowEnabled();
    await verifyPaymentMatchesContractIntent(intentId, payment);
  }

  const maxFee = (BigInt(config.baseFee) * BigInt(config.feeBumpMultiplier)).toString();
  const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    sponsorKeypair.publicKey(),
    maxFee,
    innerTransaction,
    config.passphrase
  );
  feeBump.sign(sponsorKeypair);

  const result = await server.submitTransaction(feeBump);
  let contractConfirmation = null;

  if (intentId) {
    try {
      contractConfirmation = await confirmContractIntent(intentId, result.hash);
    } catch (error) {
      contractConfirmation = {
        status: 'failed',
        error: error.message,
      };
      console.error('Contract confirmation failed after Stellar payment submission:', {
        intentId,
        paymentHash: result.hash,
        error: error.message,
      });
    }
  }

  const cachedIntent = intentId ? contractIntentCache.get(intentId) : null;
  await recordPaymentReceipt({
    txHash: result.hash,
    source: payment.source,
    destination: payment.destination,
    amount: payment.amount,
    merchantId: cachedIntent?.merchantId || null,
    transactionType: cachedIntent?.merchantId ? 'merchant' : 'personal',
    intentId,
    note: cachedIntent?.note || null,
  });

  const response = {
    hash: result.hash,
    ledger: result.ledger,
    status: 'success',
    ...(intentId ? {
      intentId,
      contractConfirmation,
    } : {}),
  };

  if (idempotencyKey) {
    idempotencyCache.set(idempotencyKey, response);
    setTimeout(() => idempotencyCache.delete(idempotencyKey), config.idempotencyTtlMs).unref();
  }

  res.json(response);
});

app.post('/add-money', requireAuthenticatedUser, async (req, res) => {
  if (!config.addMoneyEnabled) {
    return res.status(403).json({
      error: 'Add Money is disabled for this network',
      code: 'ADD_MONEY_DISABLED',
    });
  }

  const accountId = assertAccountId(req.body.accountId, 'accountId');
  const amount = normalizeAmount(req.body.amount || config.addMoneyAmount, config.maxAddMoneyAmount);
  const idempotencyKey = normalizeOptionalString(req.body.idempotencyKey);

  if (idempotencyKey && idempotencyCache.has(idempotencyKey)) {
    return res.json(idempotencyCache.get(idempotencyKey));
  }

  const status = await getAccountStatus(accountId);
  if (!status.exists || !status.hasTrustline) {
    return res.status(409).json({
      error: 'Account is not ready to receive Add Money balance',
      code: 'ACCOUNT_NOT_READY',
    });
  }

  const retryAfterSeconds = await getAddMoneyRetryAfterSeconds(accountId);
  if (retryAfterSeconds > 0) {
    return res.status(429).json({
      error: 'Add Money is cooling down for this account',
      code: 'ADD_MONEY_COOLDOWN',
      retryAfterSeconds,
    });
  }

  const distributionBalances = await getBalances(distributionKeypair.publicKey());
  if (Number(distributionBalances.asset || '0') < Number(amount)) {
    return res.status(503).json({
      error: `Add Money is temporarily unavailable because the relayer distribution account has insufficient ${config.assetCode}.`,
      code: 'DISTRIBUTION_LOW_ASSET',
      distributionBalance: distributionBalances.asset,
      requiredAmount: amount,
    });
  }

  const distributionAccount = await server.loadAccount(distributionKeypair.publicKey());
  const tx = new StellarSdk.TransactionBuilder(distributionAccount, {
    fee: config.baseFee,
    networkPassphrase: config.passphrase,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: accountId,
      asset: cpinrAsset,
      amount,
    }))
    .addMemo(StellarSdk.Memo.text('add-money'))
    .setTimeout(config.transactionTimeoutSeconds)
    .build();

  tx.sign(distributionKeypair);

  const result = await server.submitTransaction(tx);
  const response = {
    hash: result.hash,
    ledger: result.ledger,
    status: 'success',
    amount,
    assetCode: config.assetCode,
  };

  const nextAvailableAt = new Date(Date.now() + config.addMoneyCooldownMs).toISOString();
  addMoneyCooldowns.set(accountId, Date.parse(nextAvailableAt));
  await recordAddMoneyClaim({
    walletAddress: accountId,
    amount,
    txHash: result.hash,
    idempotencyKey,
    nextAvailableAt,
  });

  if (idempotencyKey) {
    idempotencyCache.set(idempotencyKey, response);
    setTimeout(() => idempotencyCache.delete(idempotencyKey), config.idempotencyTtlMs).unref();
  }

  res.json(response);
});

app.get('/tx/:hash', async (req, res) => {
  const hash = normalizeOptionalString(req.params.hash);
  if (!hash || !/^[a-fA-F0-9]{64}$/.test(hash)) {
    return res.status(400).json({ error: 'Invalid transaction hash' });
  }

  try {
    const tx = await server.transactions().transaction(hash).call();
    return res.json({
      hash,
      status: tx.successful ? 'success' : 'failed',
      ledger: tx.ledger,
      createdAt: tx.created_at,
      feeCharged: tx.fee_charged,
    });
  } catch (error) {
    if (error?.response?.status === 404) {
      return res.json({ hash, status: 'pending' });
    }
    throw error;
  }
});

app.use((error, _req, res, _next) => {
  const horizonStatus = error.response?.status;
  const horizonExtras = error.response?.data?.extras;
  const resultCodes = horizonExtras?.result_codes;
  const status = error.statusCode || error.status || horizonStatus || 500;
  const stellarCode = resultCodes?.operations?.find(code => code !== 'op_success') || resultCodes?.transaction;
  const code = error.code || (stellarCode ? `STELLAR_${stellarCode.toUpperCase()}` : undefined);
  const stellarMessage = getStellarErrorMessage(resultCodes);
  const message = status >= 500 ? 'Relayer service error' : error.message;

  if (status >= 500) {
    console.error('Relayer error:', {
      message: error.message,
      response: error.response?.data,
    });
  }

  res.status(status).json({
    error: stellarMessage || message,
    code,
    resultCodes,
  });
});

const relayerHttpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`C-Pay Stellar relayer listening on port ${PORT}`);
  console.log(`Network: ${config.networkName}`);
  console.log(`Sponsor: ${sponsorKeypair.publicKey()}`);
  console.log(`Distribution: ${distributionKeypair.publicKey()}`);
});
relayerHttpServer.ref();

function loadConfig() {
  const networkName = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();
  const network = NETWORKS[networkName] || NETWORKS.testnet;
  const horizonUrl = process.env.STELLAR_HORIZON_URL || network.horizonUrl;
  const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE || network.passphrase;
  const sponsorSecret = requireEnv('SPONSOR_SECRET');
  const distributionSecret = requireEnv('DISTRIBUTION_SECRET');
  const assetCode = process.env.CPINR_ASSET_CODE || 'CPINR';
  const assetIssuer = requireEnv('CPINR_ASSET_ISSUER');
  const authRequired = readBooleanEnv('RELAYER_AUTH_REQUIRED', networkName === 'public');
  const addMoneyEnabled = readBooleanEnv('ENABLE_ADD_MONEY', networkName !== 'public');
  const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET || '';
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const sorobanRpcUrl = process.env.SOROBAN_RPC_URL || (networkName === 'testnet' ? 'https://soroban-testnet.stellar.org' : '');
  const cpayContractId = process.env.CPAY_CONTRACT_ID || '';
  const tokenContractId = process.env.TOKEN_CONTRACT_ID || '';
  const relayerSecret = process.env.RELAYER_SECRET || '';
  const contractAdminSecret = process.env.CONTRACT_ADMIN_SECRET || '';
  const contractFlowEnabled = readBooleanEnv(
    'CONTRACT_FLOW_ENABLED',
    Boolean(sorobanRpcUrl && cpayContractId && relayerSecret)
  );

  assertTrustedHorizonUrl(horizonUrl);
  if (sorobanRpcUrl) {
    assertTrustedSorobanUrl(sorobanRpcUrl);
  }

  if (authRequired && !supabaseJwtSecret && (!supabaseUrl || !supabaseServiceRoleKey)) {
    throw new Error('SUPABASE_JWT_SECRET or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY is required when relayer authentication is enabled');
  }

  if (cpayContractId && !StellarSdk.StrKey.isValidContract(cpayContractId)) {
    throw new Error('CPAY_CONTRACT_ID must be a valid contract address');
  }

  if (tokenContractId && !StellarSdk.StrKey.isValidContract(tokenContractId)) {
    throw new Error('TOKEN_CONTRACT_ID must be a valid contract address');
  }

  if (relayerSecret && !StellarSdk.StrKey.isValidEd25519SecretSeed(relayerSecret)) {
    throw new Error('RELAYER_SECRET must be a valid Stellar secret seed');
  }

  if (contractAdminSecret && !StellarSdk.StrKey.isValidEd25519SecretSeed(contractAdminSecret)) {
    throw new Error('CONTRACT_ADMIN_SECRET must be a valid Stellar secret seed');
  }

  if (contractFlowEnabled && (!sorobanRpcUrl || !cpayContractId || !relayerSecret)) {
    throw new Error('SOROBAN_RPC_URL, CPAY_CONTRACT_ID, and RELAYER_SECRET are required when CONTRACT_FLOW_ENABLED=true');
  }

  return {
    networkName,
    horizonUrl,
    passphrase,
    sponsorSecret,
    distributionSecret,
    assetCode,
    assetIssuer,
    baseFee: process.env.STELLAR_BASE_FEE || StellarSdk.BASE_FEE,
    feeBumpMultiplier: Number(process.env.FEE_BUMP_MULTIPLIER || 10),
    transactionTimeoutSeconds: Number(process.env.TRANSACTION_TIMEOUT_SECONDS || 60),
    startingBalance: process.env.STARTING_BALANCE || '1.5',
    trustlineLimit: process.env.TRUSTLINE_LIMIT || '1000000000',
    addMoneyAmount: process.env.ADD_MONEY_AMOUNT || '100',
    maxAddMoneyAmount: Number(process.env.MAX_ADD_MONEY_AMOUNT || 1000),
    maxPaymentAmount: Number(process.env.MAX_PAYMENT_AMOUNT || 100000),
    addMoneyCooldownMs: Number(process.env.ADD_MONEY_COOLDOWN_MS || 24 * 60 * 60 * 1000),
    idempotencyTtlMs: Number(process.env.IDEMPOTENCY_TTL_MS || 10 * 60 * 1000),
    lowXlmThreshold: Number(process.env.LOW_XLM_THRESHOLD || 5),
    lowAssetThreshold: Number(process.env.LOW_CPINR_THRESHOLD || 1000),
    authRequired,
    supabaseJwtSecret,
    supabaseUrl,
    supabaseServiceRoleKey,
    addMoneyEnabled,
    sorobanRpcUrl,
    cpayContractId,
    tokenContractId,
    relayerSecret,
    contractAdminSecret,
    contractFlowEnabled,
    contractIntentTtlSeconds: Number(process.env.CONTRACT_INTENT_TTL_SECONDS || 600),
  };
}

function readBooleanEnv(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseCorsOrigin(value) {
  if (value === '*') {
    return '*';
  }

  const origins = value
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return origins.length <= 1 ? origins[0] || '*' : origins;
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

function assertTrustedHorizonUrl(horizonUrl) {
  const parsed = new URL(horizonUrl);
  const allowCustom = process.env.ALLOW_CUSTOM_HORIZON === 'true';
  const allowedHosts = new Set(['horizon-testnet.stellar.org', 'horizon.stellar.org']);

  if (parsed.protocol !== 'https:' && process.env.ALLOW_HTTP_HORIZON !== 'true') {
    throw new Error('Horizon URL must use HTTPS unless ALLOW_HTTP_HORIZON=true');
  }

  if (!allowCustom && !allowedHosts.has(parsed.hostname)) {
    throw new Error('Custom Horizon hosts require ALLOW_CUSTOM_HORIZON=true');
  }
}

function assertTrustedSorobanUrl(rpcUrl) {
  const parsed = new URL(rpcUrl);
  const allowCustom = process.env.ALLOW_CUSTOM_SOROBAN_RPC === 'true';
  const allowedHosts = new Set(['soroban-testnet.stellar.org', 'mainnet.sorobanrpc.com']);

  if (parsed.protocol !== 'https:' && process.env.ALLOW_HTTP_SOROBAN_RPC !== 'true') {
    throw new Error('Soroban RPC URL must use HTTPS unless ALLOW_HTTP_SOROBAN_RPC=true');
  }

  if (!allowCustom && parsed.protocol === 'https:' && !allowedHosts.has(parsed.hostname)) {
    throw new Error('Custom Soroban RPC hosts require ALLOW_CUSTOM_SOROBAN_RPC=true');
  }
}

function assertAccountId(value, label) {
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(value || '')) {
    const error = new Error(`Invalid Stellar ${label}`);
    error.statusCode = 400;
    throw error;
  }
  return value;
}

function assertTransactionEnvelopeXdr(value) {
  if (typeof value !== 'string') {
    const error = new Error('Invalid transaction XDR');
    error.statusCode = 400;
    throw error;
  }

  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 20000) {
    const error = new Error('Invalid transaction XDR');
    error.statusCode = 400;
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
    throw error;
  }

  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > maxAmount) {
    const error = new Error(`Amount must be greater than 0 and no more than ${maxAmount}`);
    error.statusCode = 400;
    throw error;
  }

  return amount;
}

function normalizeMerchantId(value) {
  const merchantId = normalizeOptionalString(value);
  if (!merchantId || merchantId.length > 128) {
    const error = new Error('Invalid merchant ID');
    error.statusCode = 400;
    throw error;
  }

  return merchantId;
}

function normalizeIntentId(value) {
  const intentId = normalizeOptionalString(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(intentId)) {
    const error = new Error('Invalid payment intent ID');
    error.statusCode = 400;
    throw error;
  }

  return intentId;
}

function normalizeOptionalIntentId(value) {
  return normalizeOptionalString(value) ? normalizeIntentId(value) : '';
}

function amountToContractUnits(amount) {
  const [whole, fraction = ''] = amount.split('.');
  const fractionPadded = fraction.padEnd(7, '0');
  return BigInt(whole) * 10_000_000n + BigInt(fractionPadded);
}

function merchantIdToContractKeyHex(merchantId) {
  return crypto.createHash('sha256').update(`cpay:merchant:${merchantId}`).digest('hex');
}

function bytes32ScVal(hex) {
  if (!/^[a-fA-F0-9]{64}$/.test(hex || '')) {
    const error = new Error('Expected a 32-byte hex value');
    error.statusCode = 400;
    throw error;
  }

  return StellarSdk.nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });
}

function accountAddressScVal(accountId) {
  return new StellarSdk.Address(accountId).toScVal();
}

function i128ScVal(value) {
  return StellarSdk.nativeToScVal(BigInt(value), { type: 'i128' });
}

function u64ScVal(value) {
  return StellarSdk.nativeToScVal(BigInt(value), { type: 'u64' });
}

function assertContractFlowEnabled() {
  if (!config.contractFlowEnabled || !sorobanServer || !cpayContract) {
    const error = new Error('C-Pay contract flow is not configured on this relayer');
    error.statusCode = 503;
    error.code = 'CONTRACT_FLOW_DISABLED';
    throw error;
  }
}

function assertContractAdminConfigured() {
  if (!contractAdminKeypair) {
    const error = new Error('Contract admin key is not configured on this relayer');
    error.statusCode = 503;
    error.code = 'CONTRACT_ADMIN_NOT_CONFIGURED';
    throw error;
  }
}

async function prepareContractInvocation({ sourceAccountId, method, args }) {
  assertContractFlowEnabled();

  const sourceAccount = await sorobanServer.getAccount(sourceAccountId);
  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: config.baseFee,
    networkPassphrase: config.passphrase,
  })
    .addOperation(cpayContract.call(method, ...args))
    .setTimeout(config.transactionTimeoutSeconds)
    .build();

  const prepared = await sorobanServer.prepareTransaction(transaction);
  return prepared.toXDR();
}

async function readContract(method, args = []) {
  assertContractFlowEnabled();

  const sourceAccountId =
    relayerContractKeypair?.publicKey() ||
    contractAdminKeypair?.publicKey() ||
    sponsorKeypair.publicKey();
  const sourceAccount = await sorobanServer.getAccount(sourceAccountId);
  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: config.baseFee,
    networkPassphrase: config.passphrase,
  })
    .addOperation(cpayContract.call(method, ...args))
    .setTimeout(config.transactionTimeoutSeconds)
    .build();

  const simulation = await sorobanServer.simulateTransaction(transaction);
  if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
    const error = new Error(simulation.error || 'Contract read failed');
    error.statusCode = 502;
    throw error;
  }

  return StellarSdk.scValToNative(simulation.result.retval);
}

async function readContractConfig() {
  return readContract('config');
}

async function readContractMerchantByKey(merchantKeyHex) {
  try {
    return await readContract('merchant', [bytes32ScVal(merchantKeyHex)]);
  } catch (error) {
    if (isMissingContractRecordError(error)) {
      return null;
    }
    throw error;
  }
}

async function readContractIntent(intentId) {
  try {
    return await readContract('intent', [bytes32ScVal(intentId)]);
  } catch (error) {
    if (isMissingContractRecordError(error)) {
      return null;
    }
    throw error;
  }
}

function isMissingContractRecordError(error) {
  return /#6|#9|MerchantMissing|IntentMissing|missing/i.test(error.message || '');
}

async function invokeContractWithSigner(keypair, method, args) {
  assertContractFlowEnabled();

  const sourceAccount = await sorobanServer.getAccount(keypair.publicKey());
  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: config.baseFee,
    networkPassphrase: config.passphrase,
  })
    .addOperation(cpayContract.call(method, ...args))
    .setTimeout(config.transactionTimeoutSeconds)
    .build();

  const prepared = await sorobanServer.prepareTransaction(transaction);
  prepared.sign(keypair);

  return submitSignedSorobanTransaction(prepared);
}

async function submitSignedSorobanTransaction(transaction) {
  assertContractFlowEnabled();

  const sendResponse = await sorobanServer.sendTransaction(transaction);
  if (sendResponse.status === 'ERROR') {
    const error = new Error('Soroban transaction submission failed');
    error.statusCode = 502;
    error.details = sendResponse;
    throw error;
  }

  return waitForSorobanTransaction(sendResponse.hash);
}

async function waitForSorobanTransaction(hash) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await sorobanServer.getTransaction(hash);

    if (response.status === StellarSdk.rpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        hash,
        status: 'success',
        ledger: response.ledger,
        returnValue: response.returnValue
          ? StellarSdk.scValToNative(response.returnValue)
          : undefined,
      };
    }

    if (response.status === StellarSdk.rpc.Api.GetTransactionStatus.FAILED) {
      const error = new Error('Soroban transaction failed');
      error.statusCode = 502;
      error.details = response;
      throw error;
    }

    await delay(1000);
  }

  const error = new Error('Soroban transaction is still pending');
  error.statusCode = 504;
  throw error;
}

async function registerMerchantOnContract(merchantId, walletAddress) {
  const merchantKey = merchantIdToContractKeyHex(merchantId);
  const existing = await readContractMerchantByKey(merchantKey);

  if (!existing) {
    const result = await invokeContractWithSigner(contractAdminKeypair, 'register_merchant', [
      bytes32ScVal(merchantKey),
      accountAddressScVal(walletAddress),
    ]);

    return {
      contractStatus: 'registered',
      contractMerchantKey: merchantKey,
      contractTxHash: result.hash,
      contractLedger: result.ledger,
    };
  }

  if (existing.account !== walletAddress) {
    const result = await invokeContractWithSigner(contractAdminKeypair, 'set_merchant_account', [
      bytes32ScVal(merchantKey),
      accountAddressScVal(walletAddress),
    ]);

    return {
      contractStatus: 'account_rotated',
      contractMerchantKey: merchantKey,
      contractTxHash: result.hash,
      contractLedger: result.ledger,
    };
  }

  if (!existing.active) {
    const result = await invokeContractWithSigner(contractAdminKeypair, 'set_merchant_active', [
      bytes32ScVal(merchantKey),
      StellarSdk.nativeToScVal(true),
    ]);

    return {
      contractStatus: 'reactivated',
      contractMerchantKey: merchantKey,
      contractTxHash: result.hash,
      contractLedger: result.ledger,
    };
  }

  return {
    contractStatus: 'already_registered',
    contractMerchantKey: merchantKey,
  };
}

async function verifyPaymentMatchesContractIntent(intentId, payment) {
  const cachedIntent = contractIntentCache.get(intentId);
  const contractIntent = cachedIntent?.status === 'created'
    ? cachedIntent
    : await readContractIntent(intentId);

  if (!contractIntent) {
    const error = new Error('Payment intent was not found on the contract');
    error.statusCode = 409;
    error.code = 'CONTRACT_INTENT_MISSING';
    throw error;
  }

  const expectedPayer = contractIntent.payer;
  const expectedMerchant = contractIntent.merchant || contractIntent.merchantAddress;
  const expectedAmountUnits = String(contractIntent.amount ?? contractIntent.amountUnits);
  const paymentAmountUnits = amountToContractUnits(payment.amount).toString();

  if (expectedPayer && expectedPayer !== payment.source) {
    const error = new Error('Payment source does not match the contract intent payer');
    error.statusCode = 409;
    error.code = 'CONTRACT_INTENT_PAYER_MISMATCH';
    throw error;
  }

  if (expectedMerchant && expectedMerchant !== payment.destination) {
    const error = new Error('Payment destination does not match the contract intent merchant');
    error.statusCode = 409;
    error.code = 'CONTRACT_INTENT_MERCHANT_MISMATCH';
    throw error;
  }

  if (expectedAmountUnits !== paymentAmountUnits) {
    const error = new Error('Payment amount does not match the contract intent amount');
    error.statusCode = 409;
    error.code = 'CONTRACT_INTENT_AMOUNT_MISMATCH';
    throw error;
  }
}

async function confirmContractIntent(intentId, paymentHash) {
  if (!relayerContractKeypair) {
    const error = new Error('Contract relayer key is not configured');
    error.statusCode = 503;
    throw error;
  }

  const result = await invokeContractWithSigner(relayerContractKeypair, 'confirm_intent', [
    bytes32ScVal(intentId),
    bytes32ScVal(paymentHash),
  ]);

  const cachedIntent = contractIntentCache.get(intentId);
  if (cachedIntent) {
    cacheContractIntent(intentId, {
      ...cachedIntent,
      status: 'confirmed',
      paymentHash,
      confirmTxHash: result.hash,
      confirmLedger: result.ledger,
    });
  }

  return {
    status: 'confirmed',
    hash: result.hash,
    ledger: result.ledger,
    contractId: config.cpayContractId,
  };
}

function cacheContractIntent(intentId, value) {
  contractIntentCache.set(intentId, value);
  setTimeout(() => contractIntentCache.delete(intentId), config.contractIntentTtlSeconds * 1000).unref();
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

async function getAddMoneyRetryAfterSeconds(accountId) {
  const cooldownUntil = addMoneyCooldowns.get(accountId) || 0;
  const remainingMs = cooldownUntil - Date.now();
  const inMemoryRetryAfter = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  const persistedRetryAfter = await getPersistedAddMoneyRetryAfterSeconds(accountId);
  return Math.max(inMemoryRetryAfter, persistedRetryAfter);
}

async function getPersistedAddMoneyRetryAfterSeconds(accountId) {
  if (!isSupabasePersistenceEnabled()) {
    return 0;
  }

  try {
    const query = new URLSearchParams({
      select: 'next_available_at',
      wallet_address: `eq.${accountId}`,
      next_available_at: `gt.${new Date().toISOString()}`,
      order: 'next_available_at.desc',
      limit: '1',
    });
    const rows = await supabaseRestRequest(`add_money_claims?${query.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const nextAvailableAt = Array.isArray(rows) ? rows[0]?.next_available_at : null;
    if (!nextAvailableAt) {
      return 0;
    }

    const remainingMs = new Date(nextAvailableAt).getTime() - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  } catch (error) {
    console.warn('Add Money claim cooldown lookup skipped:', error.message);
    return 0;
  }
}

async function recordPaymentReceipt({
  txHash,
  source,
  destination,
  amount,
  merchantId,
  transactionType,
  intentId,
  note,
}) {
  if (!isSupabasePersistenceEnabled()) {
    return;
  }

  try {
    const userRows = await supabaseRestRequest(
      `users?select=id&wallet_address=eq.${encodeURIComponent(source)}&limit=1`
    );
    const userId = Array.isArray(userRows) && userRows[0]?.id ? userRows[0].id : null;
    const row = buildTrustedTransactionRow({
      userId,
      txHash,
      source,
      destination,
      amount,
      merchantId,
      transactionType,
      intentId,
      note,
    }, {
      networkName: config.networkName,
      assetCode: config.assetCode,
      assetIssuer: config.assetIssuer,
      timestamp: new Date(),
    });

    await supabaseRestRequest('transactions?on_conflict=tx_hash', {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch (error) {
    console.warn('Payment receipt persistence skipped:', error.message);
  }
}

async function recordAddMoneyClaim({
  walletAddress,
  amount,
  txHash,
  idempotencyKey,
  nextAvailableAt,
}) {
  if (!isSupabasePersistenceEnabled()) {
    return;
  }

  try {
    const conflictColumn = idempotencyKey ? 'idempotency_key' : 'tx_hash';
    const row = {
      wallet_address: walletAddress,
      amount,
      asset_code: config.assetCode,
      asset_issuer: config.assetIssuer,
      tx_hash: txHash,
      idempotency_key: idempotencyKey || null,
      next_available_at: nextAvailableAt,
    };

    await supabaseRestRequest(`add_money_claims?on_conflict=${conflictColumn}`, {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch (error) {
    console.warn('Add Money claim persistence skipped:', error.message);
  }
}

function isSupabasePersistenceEnabled() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

async function supabaseRestRequest(path, options = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch is unavailable in this Node runtime');
  }

  const baseUrl = config.supabaseUrl.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text || `Supabase request failed with status ${response.status}`);
  }

  return text ? JSON.parse(text) : null;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getStellarErrorMessage(resultCodes) {
  const operations = resultCodes?.operations || [];

  if (operations.includes('op_no_issuer')) {
    return `The configured ${config.assetCode} issuer account does not exist on ${config.networkName}. Run the testnet asset setup before using Add Money.`;
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
    throw error;
  }

  if (transaction.operations.length !== 1) {
    const error = new Error('Payment transaction must contain exactly one operation');
    error.statusCode = 400;
    throw error;
  }

  const operation = transaction.operations[0];
  if (operation.type !== 'payment') {
    const error = new Error('Only payment operations are accepted');
    error.statusCode = 400;
    throw error;
  }

  const operationSource = operation.source || transaction.source;
  if (operationSource !== transaction.source) {
    const error = new Error('Payment operation source must match transaction source');
    error.statusCode = 400;
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
    lowAsset ? `Distribution CPINR balance is ${distributionAsset}` : null,
  ].filter(Boolean);

  await fetch(process.env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service: 'cpay-stellar-relayer',
      network: config.networkName,
      warnings,
      sponsorPublicKey: sponsorKeypair.publicKey(),
      distributionPublicKey: distributionKeypair.publicKey(),
      timestamp: new Date().toISOString(),
    }),
  });
}
