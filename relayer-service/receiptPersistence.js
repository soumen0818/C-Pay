function buildTrustedTransactionRow(
  input,
  context
) {
  const timestamp = context?.timestamp || new Date();
  const networkName = context?.networkName || 'testnet';
  const assetCode = context?.assetCode || 'CPINR';
  const assetIssuer = context?.assetIssuer || '';

  return {
    user_id: input.userId || null,
    transaction_id: input.intentId || null,
    transaction_type: input.transactionType || 'personal',
    merchant_id: input.merchantId || null,
    tx_hash: input.txHash,
    stellar_network: networkName,
    asset_code: assetCode,
    asset_issuer: assetIssuer,
    to_address: input.destination,
    from_address: input.source,
    amount: input.amount,
    status: 'success',
    internal_status: 'confirmed',
    user_visible_status: 'success',
    merchant_name: null,
    note: input.note || null,
    sender_name: null,
    recipient_name: null,
    failure_reason: null,
    submitted_at: timestamp.toISOString(),
    confirmed_at: timestamp.toISOString(),
    created_at: timestamp.toISOString(),
  };
}

module.exports = { buildTrustedTransactionRow };
