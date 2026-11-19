/**
 * Key Manager & Signer Provider (Issue #22, #117)
 *
 * Provides a unified custody abstraction for Stellar signing keys:
 * - Decouples route handlers and transaction builders from raw secret keys
 * - Routes all relayer signing through KeyManager (local-keypair driver on testnet)
 * - Eliminates deceptive KMS stubs; tracks KMS driver as an explicit mainnet launch gate
 * - Enables runtime zero-downtime key rotation
 * - Audits signing activity and alerts on velocity anomalies
 */

const StellarSdk = require('@stellar/stellar-sdk');

class KeyManager {
  constructor(config = {}) {
    this.provider = (process.env.SIGNER_PROVIDER || 'env').toLowerCase();
    this.signers = new Map();
    this.activityLog = [];
    this.alertWebhookUrl = config.alertWebhookUrl || process.env.ALERT_WEBHOOK_URL || null;
    this.signingVelocityWindowMs = 60000;
    this.maxSignsPerMinute = Number(process.env.MAX_SIGNS_PER_MINUTE || 120);

    this.initSigners(config);
  }

  initSigners(config) {
    if (config.sponsorSecret) {
      this.registerSigner('sponsor', this.createSigner('sponsor', config.sponsorSecret));
    }
    if (config.distributionSecret) {
      this.registerSigner('distribution', this.createSigner('distribution', config.distributionSecret));
    }
  }

  createSigner(role, secretOrKmsId) {
    if (!secretOrKmsId) {
      throw new Error(`Missing key or KMS resource identifier for signer role: ${role}`);
    }

    if (this.provider === 'kms' || this.provider === 'vault' || secretOrKmsId.startsWith('kms://')) {
      return this.createKmsSigner(role, secretOrKmsId);
    }

    // Default: Stellar Keypair from secret (testnet pilot posture)
    const keypair = StellarSdk.Keypair.fromSecret(secretOrKmsId);
    return {
      role,
      type: 'keypair',
      publicKey: () => keypair.publicKey(),
      sign: (tx) => {
        this.recordActivity(role, 'sign_transaction');
        tx.sign(keypair);
        return tx;
      },
      signHash: (hash) => {
        this.recordActivity(role, 'sign_hash');
        return keypair.sign(hash);
      },
      getKeypair: () => keypair,
      rotatedAt: new Date().toISOString(),
    };
  }

  createKmsSigner(role, kmsUri) {
    throw new Error(
      `KMS/Vault signer driver for role '${role}' (${kmsUri}) is not yet implemented. ` +
      `Current testnet pilot posture uses the local-keypair driver ('env'). ` +
      `Production KMS driver is tracked as a mainnet launch gate in docs/custody.md.`
    );
  }

  sign(role, tx) {
    return this.getSigner(role).sign(tx);
  }

  getPublicKey(role) {
    return this.getSigner(role).publicKey();
  }

  registerSigner(role, signer) {
    this.signers.set(role, signer);
  }

  getSigner(role) {
    const signer = this.signers.get(role);
    if (!signer) {
      throw new Error(`Signer for role '${role}' is not registered`);
    }
    return signer;
  }

  /**
   * Rotate a signer key dynamically at runtime without restarting the server.
   */
  rotateKey(role, newSecretOrKmsId) {
    const newSigner = this.createSigner(role, newSecretOrKmsId);
    const oldSigner = this.signers.get(role);
    this.registerSigner(role, newSigner);

    const logEntry = {
      role,
      event: 'key_rotated',
      previousPublicKey: oldSigner ? oldSigner.publicKey() : null,
      newPublicKey: newSigner.publicKey(),
      timestamp: new Date().toISOString(),
    };
    this.activityLog.push(logEntry);
    console.log(`[KEY_CUSTODY] Key rotated successfully for role: ${role}`);

    this.sendAlert({
      event: 'KEY_ROTATED',
      role,
      newPublicKey: newSigner.publicKey(),
    }).catch(() => {});

    return newSigner;
  }

  recordActivity(role, action) {
    const now = Date.now();
    this.activityLog.push({ role, action, timestamp: now });

    // Clean up log entries older than 5 minutes
    const fiveMinAgo = now - 5 * 60 * 1000;
    this.activityLog = this.activityLog.filter(l => l.timestamp >= fiveMinAgo);

    // Velocity check (signs in the last minute)
    const oneMinAgo = now - this.signingVelocityWindowMs;
    const recentSigns = this.activityLog.filter(l => l.role === role && l.timestamp >= oneMinAgo).length;

    if (recentSigns > this.maxSignsPerMinute) {
      console.warn(`[SIGNING_VELOCITY_ALARM] High signing frequency detected for role: ${role} (${recentSigns} signs/min)`);
      this.sendAlert({
        event: 'SIGNING_VELOCITY_ALARM',
        role,
        recentSigns,
        threshold: this.maxSignsPerMinute,
      }).catch(() => {});
    }
  }

  async sendAlert(payload) {
    if (!this.alertWebhookUrl) return;
    try {
      if (typeof fetch === 'function') {
        await fetch(this.alertWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5000) : undefined,
          body: JSON.stringify({
            service: 'cpay-key-custody',
            ...payload,
            timestamp: new Date().toISOString(),
          }),
        });
      }
    } catch (err) {
      console.warn('Failed to dispatch key custody alert:', err.message);
    }
  }

  getStatus() {
    const status = {};
    for (const [role, signer] of this.signers.entries()) {
      status[role] = {
        type: signer.type,
        publicKey: signer.publicKey(),
        rotatedAt: signer.rotatedAt,
      };
    }
    return {
      provider: this.provider,
      signers: status,
      totalActivityLogs: this.activityLog.length,
    };
  }
}

module.exports = {
  KeyManager,
};
