'use strict';

const StellarSdk = require('@stellar/stellar-sdk');
const createApp = require('./app');
const { loadConfig, getPublicConfig } = require('./config');
const { KeyManager } = require('./keyManager');
const { IngestWorker } = require('./ingestWorker');

async function start(options = {}) {
  const config = options.config || loadConfig();
  const horizon = options.horizon || options.stellarServer || new StellarSdk.Horizon.Server(config.horizonUrl, {
    allowHttp: config.horizonUrl.startsWith('http://'),
  });
  const keyManager = options.keyManager || new KeyManager({
    provider: config.signerProvider,
    sponsorSecret: config.sponsorSecret,
    distributionSecret: config.distributionSecret,
    alertWebhookUrl: config.alertWebhookUrl,
    maxSignsPerMinute: config.maxSignsPerMinute,
  });
  const ingestWorker = options.ingestWorker || new IngestWorker({
    horizonUrl: config.horizonUrl,
    assetCode: config.assetCode,
    assetIssuer: config.assetIssuer,
    supabaseUrl: config.supabaseUrl,
    supabaseServiceRoleKey: config.supabaseServiceRoleKey,
    pollIntervalMs: config.ingestPollIntervalMs,
    pendingTimeoutMs: config.ingestPendingTimeoutMs,
    startCursor: config.ingestStartCursor,
  });

  const app = createApp({
    config,
    horizon,
    keyManager,
    ingestWorker,
    ...options,
  });

  if (config.authRequired) {
    await app.assertWalletBindingsReachable();

    if (!config.supabaseJwtIssuer) {
      throw new Error(
        'RELAYER_AUTH_REQUIRED is enabled but no JWT issuer could be derived. ' +
          'Set SUPABASE_URL or SUPABASE_JWT_ISSUER explicitly.'
      );
    }
  }

  const port = options.port !== undefined ? options.port : config.port;
  const listener = await new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0');
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
  listener.ref();

  console.log(`C-Pay Stellar relayer listening on port ${port}`);
  console.log('Effective relayer configuration:', getPublicConfig(config));

  // Start ledger ingest worker on startup (non-blocking)
  if (config.ledgerIngestEnabled && ingestWorker.isConfigured) {
    ingestWorker.start('stream').catch(err => {
      console.warn('Ingest worker startup warning:', err.message);
    });
  }

  // Clean up expired persisted state on startup (non-blocking)
  app.cleanExpiredPersistedState().catch(err => {
    console.error('Startup cleanup of persisted state failed:', err.message);
  });
  const cleanupTimer = setInterval(() => app.cleanExpiredPersistedState().catch(() => {}), 60 * 60 * 1000).unref();

  const balanceTimer = setInterval(() => {
    app.checkLowBalanceAlerts().catch(error => {
      console.error('Scheduled low-balance check failed:', error.message);
    });
  }, config.lowBalanceCheckIntervalMs).unref();

  return {
    server: listener,
    app,
    config,
    horizon,
    keyManager,
    ingestWorker,
    close: async () => {
      clearInterval(cleanupTimer);
      clearInterval(balanceTimer);
      if (ingestWorker && typeof ingestWorker.stop === 'function') {
        ingestWorker.stop();
      }
      await new Promise(res => listener.close(res));
    },
  };
}

if (require.main === module) {
  start().catch(error => {
    console.error('Relayer startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  start,
  createApp,
};
