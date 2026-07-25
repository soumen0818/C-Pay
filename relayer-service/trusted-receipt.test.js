const { buildTrustedTransactionRow } = require('./receiptPersistence');

describe('trusted payment receipt contract', () => {
  it('builds a row that cannot be forged by client input', () => {
    const timestamp = new Date('2024-06-15T12:00:00.000Z');

    const forgedInput = {
      txHash: 'a'.repeat(64),
      source: 'GABC1234567890',
      destination: 'GXYZ1234567890',
      amount: '1000.00',
      merchantId: 'merchant-1',
      transactionType: 'merchant',
      intentId: 'intent-1',
      note: null,
      userId: 'attacker-user-id',
      clientStatus: 'success',
      clientAmount: '999999.00',
      clientInternalStatus: 'confirmed',
      clientUserVisibleStatus: 'success',
      clientMerchantId: 'merchant-2',
      clientTransactionType: 'personal',
      clientSenderName: 'Attacker',
      clientRecipientName: 'Victim',
      clientFailureReason: null,
      clientCreatedAt: '2020-01-01T00:00:00.000Z',
      clientSubmittedAt: '2020-01-01T00:00:00.000Z',
      clientConfirmedAt: '2020-01-02T00:00:00.000Z',
    };

    const row = buildTrustedTransactionRow(forgedInput, {
      networkName: 'testnet',
      assetCode: 'CPINR',
      assetIssuer: 'ISSUER',
      timestamp,
    });

    expect(row.status).toBe('success');
    expect(row.internal_status).toBe('confirmed');
    expect(row.user_visible_status).toBe('success');
    expect(row.amount).toBe('1000.00');
    expect(row.merchant_id).toBe('merchant-1');
    expect(row.transaction_type).toBe('merchant');
    expect(row.failure_reason).toBeNull();
    expect(row.merchant_name).toBeNull();
    expect(row.sender_name).toBeNull();
    expect(row.recipient_name).toBeNull();
    expect(row.user_id).toBe('attacker-user-id');
    expect(row.stellar_network).toBe('testnet');
    expect(row.asset_code).toBe('CPINR');
    expect(row.asset_issuer).toBe('ISSUER');
    expect(row.tx_hash).toBe('a'.repeat(64));
    expect(row.submitted_at).toBe(timestamp.toISOString());
    expect(row.confirmed_at).toBe(timestamp.toISOString());
    expect(row.created_at).toBe(timestamp.toISOString());
  });
});
