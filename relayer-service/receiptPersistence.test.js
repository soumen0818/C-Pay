const { buildTrustedTransactionRow } = require('./receiptPersistence');

describe('buildTrustedTransactionRow', () => {
  it('ignores forged client status and amount values', () => {
    const timestamp = new Date('2024-01-02T03:04:05.000Z');

    const row = buildTrustedTransactionRow({
      txHash: 'a'.repeat(64),
      source: 'GABC1234567890',
      destination: 'GXYZ1234567890',
      amount: '12.34',
      merchantId: 'merchant-123',
      transactionType: 'merchant',
      intentId: 'intent-123',
      note: 'paid',
      clientStatus: 'pending',
      clientAmount: '999999',
      clientInternalStatus: 'submitted',
      clientUserVisibleStatus: 'failed',
      clientCreatedAt: '2020-01-01T00:00:00.000Z',
      clientConfirmedAt: '2020-01-02T00:00:00.000Z',
    }, {
      networkName: 'testnet',
      assetCode: 'CPINR',
      assetIssuer: 'ISSUER',
      timestamp,
    });

    expect(row).toMatchObject({
      tx_hash: 'a'.repeat(64),
      transaction_type: 'merchant',
      status: 'success',
      internal_status: 'confirmed',
      user_visible_status: 'success',
      amount: '12.34',
      failure_reason: null,
      submitted_at: timestamp.toISOString(),
      confirmed_at: timestamp.toISOString(),
      created_at: timestamp.toISOString(),
    });
    expect(row.amount).not.toBe('999999');
    expect(row.status).not.toBe('pending');
  });

  it('uses only trusted inputs for merchant revenue fields', () => {
    const timestamp = new Date('2024-06-15T12:00:00.000Z');

    const row = buildTrustedTransactionRow({
      txHash: 'b'.repeat(64),
      source: 'GABC1234567890',
      destination: 'GXYZ1234567890',
      amount: '50.00',
      merchantId: 'merchant-456',
      transactionType: 'merchant',
      intentId: 'intent-456',
      note: null,
      clientMerchantId: 'different-merchant',
      clientTransactionType: 'personal',
      clientSenderName: 'Fake Sender',
      clientRecipientName: 'Fake Recipient',
      clientFailureReason: 'Forged failure',
    }, {
      networkName: 'public',
      assetCode: 'CPINR',
      assetIssuer: 'ISSUER',
      timestamp,
    });

    expect(row).toMatchObject({
      tx_hash: 'b'.repeat(64),
      merchant_id: 'merchant-456',
      transaction_type: 'merchant',
      amount: '50.00',
      status: 'success',
      internal_status: 'confirmed',
      user_visible_status: 'success',
      merchant_name: null,
      sender_name: null,
      recipient_name: null,
      failure_reason: null,
      stellar_network: 'public',
      asset_code: 'CPINR',
      asset_issuer: 'ISSUER',
      submitted_at: timestamp.toISOString(),
      confirmed_at: timestamp.toISOString(),
      created_at: timestamp.toISOString(),
    });
    expect(row.merchant_id).not.toBe('different-merchant');
    expect(row.transaction_type).not.toBe('personal');
    expect(row.failure_reason).toBeNull();
  });

  it('falls back to defaults when optional trusted inputs are missing', () => {
    const timestamp = new Date('2024-06-15T12:00:00.000Z');

    const row = buildTrustedTransactionRow({}, {
      networkName: 'testnet',
      assetCode: 'CPINR',
      assetIssuer: '',
      timestamp,
    });

    expect(row).toMatchObject({
      user_id: null,
      transaction_id: null,
      transaction_type: 'personal',
      merchant_id: null,
      status: 'success',
      internal_status: 'confirmed',
      user_visible_status: 'success',
      stellar_network: 'testnet',
      asset_code: 'CPINR',
      asset_issuer: '',
      merchant_name: null,
      note: null,
      sender_name: null,
      recipient_name: null,
      failure_reason: null,
      submitted_at: timestamp.toISOString(),
      confirmed_at: timestamp.toISOString(),
      created_at: timestamp.toISOString(),
    });
  });
});
