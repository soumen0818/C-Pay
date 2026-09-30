'use strict';

const StellarSdk = require('@stellar/stellar-sdk');

const DEFAULT_CURSOR_KEY = 'horizon_payments_cursor';
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_PENDING_TIMEOUT_MS = 300000; // 5 minutes
const DEFAULT_RECONCILE_INTERVAL_MS = 30000; // 30 seconds

class IngestWorker {
  constructor(options = {}) {
    this.horizonUrl = options.horizonUrl || process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
    this.assetCode = options.assetCode || 'USDC';
    this.assetIssuer = options.assetIssuer || process.env.USDC_ASSET_ISSUER || '';
    this.supabaseUrl = (options.supabaseUrl || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    this.supabaseServiceRoleKey = options.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    this.cursorKey = options.cursorKey || DEFAULT_CURSOR_KEY;
    this.pollIntervalMs = Number(options.pollIntervalMs || process.env.INGEST_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS);
    this.pendingTimeoutMs = Number(options.pendingTimeoutMs || process.env.INGEST_PENDING_TIMEOUT_MS || DEFAULT_PENDING_TIMEOUT_MS);
    this.reconcileIntervalMs = Number(options.reconcileIntervalMs || DEFAULT_RECONCILE_INTERVAL_MS);
    this.startCursor = options.startCursor || process.env.INGEST_START_CURSOR || null;
    this.customFetch = options.fetch || (typeof fetch === 'function' ? fetch : null);

    this.server = new StellarSdk.Horizon.Server(this.horizonUrl, {
      allowHttp: this.horizonUrl.startsWith('http://'),
    });

    this.status = 'idle'; // idle, running, stopped, error
    this.lastCursor = null;
    this.lastIngestedLedger = null;
    this.latestNetworkLedger = null;
    this.lastIngestedAt = null;
    this.processedCount = 0;
    this.reconciledCount = 0;
    this.errorCount = 0;
    this.lastError = null;

    this.streamCloseFn = null;
    this.pollTimer = null;
    this.reconcileTimer = null;
    this.isPolling = false;
    this.isReconciling = false;

    // Cache of known wallet addresses to user IDs
    this.walletUserCache = new Map();
    this.lastCacheRefresh = 0;
  }

  get isConfigured() {
    return Boolean(this.supabaseUrl && this.supabaseServiceRoleKey);
  }

  async start(mode = 'stream') {
    if (this.status === 'running') {
      return;
    }

    this.status = 'running';
    try {
      await this.initCursor();
      await this.refreshWalletCache();

      if (mode === 'stream') {
        this.startStreaming();
      } else {
        this.startPolling();
      }

      this.startReconciliation();
      console.log(`[IngestWorker] Started in ${mode} mode from cursor ${this.lastCursor || 'now'}`);
    } catch (err) {
      this.status = 'error';
      this.lastError = err.message;
      this.errorCount++;
      console.error('[IngestWorker] Failed to start:', err.message);
      throw err;
    }
  }

  async stop() {
    this.status = 'stopped';
    if (this.streamCloseFn) {
      try {
        this.streamCloseFn();
      } catch (_) {}
      this.streamCloseFn = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    console.log('[IngestWorker] Stopped');
  }

  async initCursor() {
    const stored = await this.loadStoredCursor();
    if (stored) {
      this.lastCursor = stored.cursor;
      this.lastIngestedLedger = stored.last_ledger || null;
    } else if (this.startCursor) {
      this.lastCursor = this.startCursor;
    } else {
      // Default to 'now' to avoid scanning from genesis on fresh start
      this.lastCursor = 'now';
    }
  }

  async loadStoredCursor() {
    if (!this.isConfigured) return null;
    try {
      const records = await this.supabaseRequest(
        `ingest_state?key=eq.${encodeURIComponent(this.cursorKey)}&select=cursor,last_ledger,updated_at`
      );
      if (records && records.length > 0) {
        return records[0];
      }
    } catch (err) {
      console.warn('[IngestWorker] Could not load stored cursor:', err.message);
    }
    return null;
  }

  async saveStoredCursor(cursor, ledger = null) {
    this.lastCursor = cursor;
    if (ledger) this.lastIngestedLedger = ledger;
    this.lastIngestedAt = new Date().toISOString();

    if (!this.isConfigured) return;
    try {
      await this.supabaseRequest('ingest_state', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          key: this.cursorKey,
          cursor: String(cursor),
          last_ledger: ledger ? Number(ledger) : null,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (err) {
      console.warn('[IngestWorker] Could not persist cursor:', err.message);
    }
  }

  async refreshWalletCache() {
    if (!this.isConfigured) return;
    try {
      const now = Date.now();
      if (now - this.lastCacheRefresh < 60000 && this.walletUserCache.size > 0) {
        return;
      }
      const users = await this.supabaseRequest('users?select=id,wallet_address');
      if (Array.isArray(users)) {
        this.walletUserCache.clear();
        for (const u of users) {
          if (u.wallet_address) {
            this.walletUserCache.set(u.wallet_address, u.id);
          }
        }
      }

      this.lastCacheRefresh = now;
    } catch (err) {
      this.errorCount++;
      this.lastError = err.message;
      console.warn('[IngestWorker] Failed to refresh wallet cache:', err.message);
    }
  }

  startStreaming() {
    const cursor = this.lastCursor === 'now' ? 'now' : this.lastCursor;

    const builder = this.server
      .payments()
      .cursor(cursor)
      .order('asc');

    this.streamCloseFn = builder.stream({
      onmessage: async (operation) => {
        try {
          await this.processOperation(operation);
        } catch (err) {
          this.errorCount++;
          this.lastError = err.message;
          console.error('[IngestWorker] Error processing streamed operation:', err.message);
        }
      },
      onerror: (err) => {
        console.warn('[IngestWorker] Stream error, falling back to polling:', err.message || err);
        this.errorCount++;
        if (this.streamCloseFn) {
          try {
            this.streamCloseFn();
          } catch (_) {}
          this.streamCloseFn = null;
        }
        if (this.status === 'running') {
          this.startPolling();
        }
      },
    });
  }

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(async () => {
      if (this.isPolling || this.status !== 'running') return;
      this.isPolling = true;
      try {
        await this.pollOnce();
      } catch (err) {
        this.errorCount++;
        this.lastError = err.message;
        console.error('[IngestWorker] Poll error:', err.message);
      } finally {
        this.isPolling = false;
      }
    }, this.pollIntervalMs);
  }

  async pollOnce(limit = 50) {
    const builder = this.server.payments().order('asc').limit(limit);
    if (this.lastCursor && this.lastCursor !== 'now') {
      builder.cursor(this.lastCursor);
    } else {
      builder.cursor('now');
    }

    const response = await builder.call();
    const records = response.records || [];
    for (const record of records) {
      await this.processOperation(record);
    }
    await this.updateLatestLedger();
  }

  async updateLatestLedger() {
    try {
      const latestLedgers = await this.server.ledgers().order('desc').limit(1).call();
      if (latestLedgers.records && latestLedgers.records.length > 0) {
        this.latestNetworkLedger = latestLedgers.records[0].sequence;
      }
    } catch (err) {
      this.errorCount++;
      this.lastError = err.message;
      console.warn('[IngestWorker] Failed to update latest ledger:', err.message);
    }
  }

  async processOperation(operation) {
    if (!operation || !operation.id) return;

    // Filter to payment operations only (drop create_account and path payments)
    if (operation.type !== 'payment') {
      const ledgerSeq = this.extractLedgerSequence(operation);
      if (ledgerSeq) this.lastIngestedLedger = ledgerSeq;
      await this.saveStoredCursor(operation.paging_token || operation.id, ledgerSeq);
      return;
    }

    const details = this.extractOperationDetails(operation);
    if (!details) {
      const ledgerSeq = this.extractLedgerSequence(operation);
      if (ledgerSeq) this.lastIngestedLedger = ledgerSeq;
      await this.saveStoredCursor(operation.paging_token || operation.id, ledgerSeq);
      return;
    }

    // Filter to configured asset (do not ingest unrelated assets)
    if (details.asset_code !== this.assetCode) {
      if (details.ledger_sequence) this.lastIngestedLedger = details.ledger_sequence;
      await this.saveStoredCursor(operation.paging_token || operation.id, details.ledger_sequence);
      return;
    }
    if (this.assetIssuer && details.asset_issuer && details.asset_issuer !== this.assetIssuer) {
      if (details.ledger_sequence) this.lastIngestedLedger = details.ledger_sequence;
      await this.saveStoredCursor(operation.paging_token || operation.id, details.ledger_sequence);
      return;
    }

    // Match users - restrict ingestion to known accounts
    const fromUserId = this.walletUserCache.get(details.from_address) || null;
    const toUserId = this.walletUserCache.get(details.to_address) || null;
    const matchedUserId = fromUserId || toUserId;

    if (!matchedUserId) {
      // Neither party is known to the system: skip storing this transaction
      if (details.ledger_sequence) this.lastIngestedLedger = details.ledger_sequence;
      await this.saveStoredCursor(operation.paging_token || operation.id, details.ledger_sequence);
      return;
    }

    // Ingest into Supabase
    if (this.isConfigured) {
      await this.upsertTransaction({
        tx_hash: details.tx_hash,
        op_index: details.op_index,
        transaction_type: 'personal',
        from_address: details.from_address,
        to_address: details.to_address,
        amount: details.amount,
        asset_code: details.asset_code,
        asset_issuer: details.asset_issuer,
        status: 'success',
        internal_status: 'confirmed',
        user_visible_status: 'success',
        confirmed_at: details.created_at,
        submitted_at: details.created_at,
        user_id: matchedUserId,
      });
    }

    this.processedCount++;
    if (details.ledger_sequence) {
      this.lastIngestedLedger = details.ledger_sequence;
    }
    await this.saveStoredCursor(operation.paging_token || operation.id, details.ledger_sequence);
  }

  extractOperationDetails(op) {
    const txHash = op.transaction_hash;
    if (!txHash) return null;

    if (op.type !== 'payment') {
      return null;
    }

    const fromAddress = op.from || op.source_account || '';
    const toAddress = op.to || '';
    const amount = op.amount || '0';
    const assetCode = op.asset_type === 'native' ? 'XLM' : (op.asset_code || null);
    const assetIssuer = op.asset_type === 'native' ? null : (op.asset_issuer || null);

    if (!assetCode) {
      return null;
    }

    // Extract op_index from paging_token or operation id
    const opIndex = this.extractOpIndex(op);
    const ledgerSeq = this.extractLedgerSequence(op);

    return {
      tx_hash: txHash,
      op_index: opIndex,
      from_address: fromAddress,
      to_address: toAddress,
      amount,
      asset_code: assetCode,
      asset_issuer: assetIssuer,
      created_at: op.created_at || new Date().toISOString(),
      ledger_sequence: ledgerSeq,
    };
  }

  extractOpIndex(op) {
    const raw = op.paging_token || op.id;
    if (raw) {
      const str = String(raw);
      if (str.includes('-')) {
        const parts = str.split('-');
        const parsed = Number(parts[parts.length - 1]);
        if (!Number.isNaN(parsed)) return parsed;
      }
      try {
        const bigToken = BigInt(str);
        return Number(bigToken & 4095n);
      } catch (err) {
        this.errorCount++;
        this.lastError = err.message;
        console.warn('[IngestWorker] Failed to extract op index from token:', err.message);
      }
    }
    return 0;
  }

  extractLedgerSequence(op) {
    if (op.transaction_attr && op.transaction_attr.ledger) {
      return op.transaction_attr.ledger;
    }
    const raw = op.paging_token || op.id;
    if (raw) {
      try {
        const str = String(raw).split('-')[0];
        const bigToken = BigInt(str);
        const ledger = Number(bigToken >> 24n);
        if (ledger > 0) return ledger;
        if (str.length <= 10) {
          const direct = Number(str);
          if (direct > 0 && direct < 16777216) return direct;
        }
      } catch (err) {
        this.errorCount++;
        this.lastError = err.message;
        console.warn('[IngestWorker] Failed to extract ledger sequence from token:', err.message);
      }
    }
    return null;
  }

  async upsertTransaction(tx) {
    try {
      await this.supabaseRequest('transactions?on_conflict=tx_hash,op_index', {
        method: 'POST',
        headers: {
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(tx),
      });
    } catch (err) {
      this.errorCount++;
      this.lastError = err.message;
      console.warn('[IngestWorker] Upsert transaction failed:', err.message);
      throw err;
    }
  }

  startReconciliation() {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setInterval(async () => {
      if (this.isReconciling || this.status !== 'running') return;
      this.isReconciling = true;
      try {
        await this.reconcilePendingTransactions();
      } catch (err) {
        console.warn('[IngestWorker] Reconciliation error:', err.message);
      } finally {
        this.isReconciling = false;
      }
    }, this.reconcileIntervalMs);
  }

  async reconcilePendingTransactions() {
    if (!this.isConfigured) return;
    const cutoff = new Date(Date.now() - this.pendingTimeoutMs).toISOString();

    const pendingList = await this.supabaseRequest(
      `transactions?status=eq.pending&submitted_at=lt.${encodeURIComponent(cutoff)}&select=id,tx_hash,submitted_at`
    );

    if (!Array.isArray(pendingList) || pendingList.length === 0) {
      return;
    }

    for (const pending of pendingList) {
      if (!pending.tx_hash) continue;
      try {
        // Check if transaction exists on Horizon
        const txRecord = await this.server.transactions().transaction(pending.tx_hash).call();
        if (txRecord && txRecord.successful) {
          // Transaction succeeded on chain: reconcile status
          await this.supabaseRequest(`transactions?id=eq.${pending.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'success',
              internal_status: 'confirmed',
              user_visible_status: 'success',
              confirmed_at: txRecord.created_at || new Date().toISOString(),
            }),
          });
          this.reconciledCount++;
        }
      } catch (err) {
        if (err.response && err.response.status === 404) {
          // Timed out and not found on chain: mark failed
          await this.supabaseRequest(`transactions?id=eq.${pending.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              status: 'failed',
              internal_status: 'failed',
              user_visible_status: 'failed',
              failure_reason: 'Transaction not found on chain after timeout window',
            }),
          });
          this.reconciledCount++;
        }
      }
    }
  }

  getLag() {
    const latest = this.latestNetworkLedger || 0;
    const ingested = this.lastIngestedLedger || 0;
    const ledgerLag = latest > 0 && ingested > 0 ? Math.max(0, latest - ingested) : 0;

    return {
      ledgerLag,
      lastIngestedLedger: this.lastIngestedLedger,
      latestNetworkLedger: this.latestNetworkLedger,
      lastIngestedAt: this.lastIngestedAt,
      lastCursor: this.lastCursor,
    };
  }

  getHealth() {
    const lag = this.getLag();
    const isHealthy = this.status === 'running' && (lag.ledgerLag < 50 || lag.ledgerLag === 0);

    return {
      status: this.status,
      healthy: isHealthy,
      lag: lag.ledgerLag,
      ...lag,
      metrics: {
        processedCount: this.processedCount,
        reconciledCount: this.reconciledCount,
        errorCount: this.errorCount,
        lastError: this.lastError,
      },
    };
  }

  async supabaseRequest(path, options = {}) {
    const doFetch = this.customFetch || fetch;
    if (typeof doFetch !== 'function') {
      throw new Error('global fetch is unavailable');
    }

    const response = await doFetch(`${this.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: this.supabaseServiceRoleKey,
        Authorization: `Bearer ${this.supabaseServiceRoleKey}`,
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
}

module.exports = {
  IngestWorker,
  DEFAULT_CURSOR_KEY,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_PENDING_TIMEOUT_MS,
};

