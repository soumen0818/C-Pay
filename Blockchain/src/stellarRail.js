const {
  StellarSdk,
  getAsset,
  getNetworkConfig,
  getServer,
} = require('./config');

function isValidPublicKey(accountId) {
  return StellarSdk.StrKey.isValidEd25519PublicKey(accountId);
}

function isValidSecret(secret) {
  return StellarSdk.StrKey.isValidEd25519SecretSeed(secret);
}

function assertPublicKey(accountId, label = 'account') {
  if (!isValidPublicKey(accountId)) {
    throw new Error(`Invalid Stellar ${label} public key`);
  }
}

function assertSecret(secret, label = 'secret') {
  if (!isValidSecret(secret)) {
    throw new Error(`Invalid Stellar ${label}`);
  }
}

function assertAmount(amount) {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Amount must be a positive number');
  }
}

function normalizeMemo(memoText) {
  if (!memoText) {
    return undefined;
  }

  if (memoText.length > 28) {
    throw new Error('Stellar text memos must be 28 bytes or less');
  }

  return StellarSdk.Memo.text(memoText);
}

function transactionFromXdr(xdr) {
  const { passphrase } = getNetworkConfig();
  return StellarSdk.TransactionBuilder.fromXDR(xdr, passphrase);
}

async function buildPaymentTransaction({
  sourceSecret,
  destination,
  amount,
  memoText,
  timeoutSeconds = 60,
}) {
  assertSecret(sourceSecret, 'source secret');
  assertPublicKey(destination, 'destination');
  assertAmount(amount);

  const source = StellarSdk.Keypair.fromSecret(sourceSecret);
  const { passphrase, baseFee } = getNetworkConfig();
  const server = getServer();
  const account = await server.loadAccount(source.publicKey());

  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: baseFee,
    networkPassphrase: passphrase,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination,
      asset: getAsset(),
      amount: amount.toString(),
    }))
    .setTimeout(timeoutSeconds);

  const memo = normalizeMemo(memoText);
  if (memo) {
    builder.addMemo(memo);
  }

  const transaction = builder.build();
  transaction.sign(source);

  return {
    xdr: transaction.toXDR(),
    hash: transaction.hash().toString('hex'),
    source: source.publicKey(),
    destination,
    amount: amount.toString(),
  };
}

function buildFeeBumpTransaction({
  feeSourceSecret,
  innerTransactionXdr,
  feeMultiplier = 10,
}) {
  assertSecret(feeSourceSecret, 'fee source secret');

  const feeSource = StellarSdk.Keypair.fromSecret(feeSourceSecret);
  const { passphrase, baseFee } = getNetworkConfig();
  const innerTransaction = transactionFromXdr(innerTransactionXdr);
  const fee = (BigInt(baseFee) * BigInt(feeMultiplier)).toString();

  const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    feeSource.publicKey(),
    fee,
    innerTransaction,
    passphrase
  );

  feeBump.sign(feeSource);

  return {
    xdr: feeBump.toXDR(),
    hash: feeBump.hash().toString('hex'),
    feeSource: feeSource.publicKey(),
    maxFee: fee,
  };
}

async function buildSponsoredAccountTransaction({
  sponsorSecret,
  newAccountPublicKey,
  newAccountSecret,
  timeoutSeconds = 60,
}) {
  assertSecret(sponsorSecret, 'sponsor secret');
  assertPublicKey(newAccountPublicKey, 'new account');

  const sponsor = StellarSdk.Keypair.fromSecret(sponsorSecret);
  const newAccount = newAccountSecret
    ? StellarSdk.Keypair.fromSecret(newAccountSecret)
    : null;

  if (newAccount && newAccount.publicKey() !== newAccountPublicKey) {
    throw new Error('newAccountSecret does not match newAccountPublicKey');
  }

  const { passphrase, baseFee } = getNetworkConfig();
  const server = getServer();
  const sponsorAccount = await server.loadAccount(sponsor.publicKey());

  const transaction = new StellarSdk.TransactionBuilder(sponsorAccount, {
    fee: baseFee,
    networkPassphrase: passphrase,
  })
    .addOperation(StellarSdk.Operation.beginSponsoringFutureReserves({
      sponsoredId: newAccountPublicKey,
    }))
    .addOperation(StellarSdk.Operation.createAccount({
      destination: newAccountPublicKey,
      // The sponsor covers account reserves; granting a balance here would
      // create spendable XLM that the account holder could withdraw.
      startingBalance: '0',
    }))
    .addOperation(StellarSdk.Operation.endSponsoringFutureReserves({
      source: newAccountPublicKey,
    }))
    .setTimeout(timeoutSeconds)
    .build();

  transaction.sign(sponsor);
  if (newAccount) {
    transaction.sign(newAccount);
  }

  return {
    xdr: transaction.toXDR(),
    hash: transaction.hash().toString('hex'),
    sponsor: sponsor.publicKey(),
    newAccount: newAccountPublicKey,
    requiresNewAccountSignature: !newAccount,
  };
}

async function buildSponsoredTrustlineTransaction({
  sponsorSecret,
  accountPublicKey,
  accountSecret,
  limit,
  timeoutSeconds = 60,
}) {
  assertSecret(sponsorSecret, 'sponsor secret');
  assertPublicKey(accountPublicKey, 'trustline account');

  const sponsor = StellarSdk.Keypair.fromSecret(sponsorSecret);
  const accountKeypair = accountSecret
    ? StellarSdk.Keypair.fromSecret(accountSecret)
    : null;

  if (accountKeypair && accountKeypair.publicKey() !== accountPublicKey) {
    throw new Error('accountSecret does not match accountPublicKey');
  }

  const { passphrase, baseFee } = getNetworkConfig();
  const server = getServer();
  const sponsorAccount = await server.loadAccount(sponsor.publicKey());

  const transaction = new StellarSdk.TransactionBuilder(sponsorAccount, {
    fee: baseFee,
    networkPassphrase: passphrase,
  })
    .addOperation(StellarSdk.Operation.beginSponsoringFutureReserves({
      sponsoredId: accountPublicKey,
    }))
    .addOperation(StellarSdk.Operation.changeTrust({
      asset: getAsset(),
      limit,
      source: accountPublicKey,
    }))
    .addOperation(StellarSdk.Operation.endSponsoringFutureReserves({
      source: accountPublicKey,
    }))
    .setTimeout(timeoutSeconds)
    .build();

  transaction.sign(sponsor);
  if (accountKeypair) {
    transaction.sign(accountKeypair);
  }

  return {
    xdr: transaction.toXDR(),
    hash: transaction.hash().toString('hex'),
    sponsor: sponsor.publicKey(),
    account: accountPublicKey,
    requiresAccountSignature: !accountKeypair,
  };
}

async function submitTransactionXdr(xdr) {
  const server = getServer();
  const transaction = transactionFromXdr(xdr);
  return server.submitTransaction(transaction);
}

async function waitForTransaction(hash, { timeoutMs = 30000, intervalMs = 2000 } = {}) {
  const server = getServer();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await server.transactions().transaction(hash).call();
    } catch (error) {
      if (error?.response?.status !== 404) {
        throw error;
      }
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return null;
}

module.exports = {
  assertAmount,
  assertPublicKey,
  assertSecret,
  buildFeeBumpTransaction,
  buildPaymentTransaction,
  buildSponsoredAccountTransaction,
  buildSponsoredTrustlineTransaction,
  isValidPublicKey,
  isValidSecret,
  submitTransactionXdr,
  transactionFromXdr,
  waitForTransaction,
};
