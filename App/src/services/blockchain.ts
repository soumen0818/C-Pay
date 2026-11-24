import Constants from 'expo-constants';
import * as StellarSdk from '@stellar/stellar-base';
import { StellarWallet } from './wallet';
import { supabase } from './supabase';
import { generateIdempotencyKey } from '../hooks/usePaymentIntent';

const getEnvVar = (key: string, fallback: string = ''): string => {
  const processEnv = process.env[key];
  if (processEnv) return processEnv;

  const extraConfig = Constants.expoConfig?.extra?.[key];
  if (extraConfig) return extraConfig;

  return fallback;
};

const getExpoDevHost = (): string => {
  const constants = Constants as any;
  const hostUri =
    Constants.expoConfig?.hostUri ||
    constants.manifest2?.extra?.expoGo?.debuggerHost ||
    constants.manifest?.debuggerHost ||
    '';

  return String(hostUri).split(':')[0] || '';
};

const isDevelopmentRuntime = (): boolean => typeof __DEV__ !== 'undefined' && __DEV__;

const resolveRelayerUrl = (): string => {
  const configuredUrl = getEnvVar('EXPO_PUBLIC_STELLAR_RELAYER_URL', '');

  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, '');
  }

  if (!isDevelopmentRuntime()) {
    return '';
  }

  const expoHost = getExpoDevHost();
  if (expoHost) {
    return `http://${expoHost}:3000`;
  }

  return 'http://localhost:3000';
};

const STELLAR_NETWORK = getEnvVar('EXPO_PUBLIC_STELLAR_NETWORK', 'testnet');
const HORIZON_URL = getEnvVar('EXPO_PUBLIC_STELLAR_HORIZON_URL', 'https://horizon-testnet.stellar.org');
const NETWORK_PASSPHRASE = getEnvVar(
  'EXPO_PUBLIC_STELLAR_NETWORK_PASSPHRASE',
  StellarSdk.Networks.TESTNET
);
const USDC_ISSUERS = {
  testnet: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  public: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
} as const;
const USDC_ASSET_CODE = 'USDC';
const USDC_ASSET_ISSUER = getEnvVar(
  'EXPO_PUBLIC_USDC_ASSET_ISSUER',
  STELLAR_NETWORK === 'public' ? USDC_ISSUERS.public : USDC_ISSUERS.testnet,
);
const RELAYER_URL = resolveRelayerUrl();
const BASE_FEE = getEnvVar('EXPO_PUBLIC_STELLAR_BASE_FEE', StellarSdk.BASE_FEE);
const RELAYER_TIMEOUT_MS = 60000;
const ACCOUNT_READY_TIMEOUT_MS = 15000;
const ACCOUNT_READY_POLL_MS = 1500;
const CONTRACT_INTENT_TIMEOUT_MS = 60000;

export type TransactionStatus = 'pending' | 'success' | 'failed' | 'not_found' | 'unknown';

export type PaymentOptions = {
  note?: string;
  idempotencyKey?: string;
};

type HorizonBalance = {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
};

type HorizonAccount = {
  id: string;
  sequence: string;
  balances: HorizonBalance[];
};

type AccountStatus = {
  exists: boolean;
  hasTrustline: boolean;
  retryAfterSeconds?: number;
};

type RelayerErrorBody = {
  error?: string;
  code?: string;
  retryAfterSeconds?: number | string;
  [key: string]: unknown;
};

export class RelayerRequestError extends Error {
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
  details?: RelayerErrorBody;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      retryAfterSeconds?: number;
      details?: RelayerErrorBody;
    } = {}
  ) {
    super(message);
    this.name = 'RelayerRequestError';
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.details = options.details;
  }
}

export function getNetworkConfig() {
  return {
    network: STELLAR_NETWORK,
    horizonUrl: HORIZON_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    assetCode: USDC_ASSET_CODE,
    assetIssuer: USDC_ASSET_ISSUER,
    relayerUrl: RELAYER_URL,
  };
}

export function getNetworkDisplayName(network?: string): string {
  const target = (network || STELLAR_NETWORK || '').toLowerCase();
  if (target === 'testnet') return 'Stellar Testnet';
  if (target === 'public' || target === 'mainnet') return 'Stellar Mainnet';
  return `Stellar ${network || STELLAR_NETWORK}`;
}

export function isValidAccountId(accountId: string): boolean {
  return StellarSdk.StrKey.isValidEd25519PublicKey(accountId || '');
}

export function getUsdcAsset(): StellarSdk.Asset {
  const expectedIssuer = STELLAR_NETWORK === 'public' ? USDC_ISSUERS.public : USDC_ISSUERS.testnet;
  if (USDC_ASSET_ISSUER !== expectedIssuer) {
    throw new Error(`USDC issuer does not match Circle's ${STELLAR_NETWORK} issuer`);
  }

  return new StellarSdk.Asset(USDC_ASSET_CODE, USDC_ASSET_ISSUER);
}

export async function getBalance(accountId: string): Promise<string> {
  if (!isValidAccountId(accountId)) {
    return '0';
  }

  try {
    const relayerBalance = await relayerRequest<{
      balance: string;
    }>(`/account/${accountId}/balance`);

    return Number(relayerBalance.balance || '0').toFixed(7);
  } catch {
    try {
      const account = await loadHorizonAccount(accountId);
      const balance = account.balances.find(item =>
        item.asset_code === USDC_ASSET_CODE &&
        item.asset_issuer === USDC_ASSET_ISSUER
      );

      return Number(balance?.balance || '0').toFixed(7);
    } catch {
      return '0.00';
    }
  }
}

export async function ensureAccountReady(wallet: StellarWallet): Promise<void> {
  const prepared = await relayerRequest<{
    alreadyReady: boolean;
    xdr?: string;
    networkPassphrase?: string;
  }>('/accounts/prepare', {
    method: 'POST',
    body: JSON.stringify({ accountId: wallet.publicKey }),
  });

  if (prepared.alreadyReady) {
    return;
  }

  if (!prepared.xdr || !prepared.networkPassphrase) {
    throw new Error('Account setup could not be prepared');
  }

  const signedXdr = wallet.signXdr(prepared.xdr, prepared.networkPassphrase);

  await relayerRequest('/accounts/submit', {
    method: 'POST',
    body: JSON.stringify({ signedXdr }),
  });

  await waitForAccountReady(wallet.publicKey);
}

export async function canAddMoney(accountId: string): Promise<boolean> {
  if (!isValidAccountId(accountId)) {
    return false;
  }

  const status = await getAccountStatus(accountId, 8000);
  return status.exists && status.hasTrustline;
}

export async function getTimeUntilNextAddMoney(accountId: string): Promise<number> {
  if (!isValidAccountId(accountId)) {
    return 0;
  }

  try {
    const status = await getAccountStatus(accountId, 8000);
    return normalizeRetryAfterSeconds(status.retryAfterSeconds);
  } catch {
    return 0;
  }
}

export function formatTimeRemaining(seconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(seconds));
  if (totalSeconds <= 0) return 'Available now';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

export async function requestAddMoney(
  wallet: StellarWallet,
  idempotencyKey?: string
): Promise<string> {
  await ensureAccountReady(wallet);

  const key = idempotencyKey || generateIdempotencyKey();

  const result = await relayerRequest<{ hash: string }>('/add-money', {
    method: 'POST',
    body: JSON.stringify({
      accountId: wallet.publicKey,
      idempotencyKey: key,
    }),
  });

  return result.hash;
}

export async function transferTokens(
  wallet: StellarWallet,
  destination: string,
  amount: string,
  options: PaymentOptions = {}
): Promise<string> {
  return sendPayment(wallet, destination, amount, options);
}

export async function sendPayment(
  wallet: StellarWallet,
  destination: string,
  amount: string,
  options: PaymentOptions = {}
): Promise<string> {
  if (!isValidAccountId(destination)) {
    throw new Error('Invalid recipient account');
  }

  const normalizedAmount = normalizeAmount(amount);
  await ensureAccountReady(wallet);

  const horizonAccount = await loadHorizonAccount(wallet.publicKey);
  const sourceAccount = new StellarSdk.Account(wallet.publicKey, horizonAccount.sequence);
  const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination,
      asset: getUsdcAsset(),
      amount: normalizedAmount,
    }))
    .setTimeout(60)
    .build();

  transaction.sign(wallet.keypair);

  const idempotencyKey = options.idempotencyKey || generateIdempotencyKey();

  const result = await relayerRequest<{ hash: string }>('/payments/submit', {
    method: 'POST',
    body: JSON.stringify({
      signedXdr: transaction.toXDR(),
      idempotencyKey,
    }),
  }, CONTRACT_INTENT_TIMEOUT_MS);

  return result.hash;
}

export async function getTransactionReceipt(txHash: string) {
  const status = await getTransactionStatus(txHash);
  if (status === 'unknown' || status === 'pending' || status === 'not_found') {
    return null;
  }

  return {
    hash: txHash,
    status: status === 'success' ? 1 : 0,
  };
}

export async function waitForTransaction(
  txHash: string,
  _confirmations: number = 1
): Promise<{ hash: string; status: number } | null> {
  for (let attempt = 0; attempt < 24; attempt++) {
    const status = await getTransactionStatus(txHash);
    if (status === 'success') {
      return { hash: txHash, status: 1 };
    }
    if (status === 'failed') {
      return { hash: txHash, status: 0 };
    }

    await new Promise(resolve => setTimeout(resolve, 2500));
  }

  return null;
}

export async function getTransactionStatus(txHash: string): Promise<TransactionStatus> {
  try {
    const result = await relayerRequest<{ status: TransactionStatus }>(`/tx/${txHash}`);
    return result.status || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getExplorerUrl(type: 'account' | 'tx', value: string): string {
  const base = getEnvVar(
    'EXPO_PUBLIC_STELLAR_EXPLORER_URL',
    STELLAR_NETWORK === 'public'
      ? 'https://stellar.expert/explorer/public'
      : 'https://stellar.expert/explorer/testnet'
  );

  return `${base}/${type}/${value}`;
}

export function isValidTransactionHash(value?: string | null): value is string {
  return /^[a-fA-F0-9]{64}$/.test(value || '');
}

export function formatTransactionHash(value?: string | null): string {
  if (!value) {
    return 'Pending';
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function normalizeAmount(value: string): string {
  const amount = String(value).trim();
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) {
    throw new Error('Please enter a valid amount');
  }

  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Please enter a valid amount');
  }

  return amount;
}

async function loadHorizonAccount(accountId: string): Promise<HorizonAccount> {
  return horizonRequest<HorizonAccount>(`/accounts/${accountId}`);
}

async function getAccountStatus(
  accountId: string,
  timeoutMs: number = RELAYER_TIMEOUT_MS
): Promise<AccountStatus> {
  return relayerRequest<AccountStatus>(`/account/${accountId}/status`, {}, timeoutMs);
}

async function waitForAccountReady(accountId: string): Promise<void> {
  const deadline = Date.now() + ACCOUNT_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const status = await getAccountStatus(accountId, 8000);
    if (status.exists && status.hasTrustline) {
      return;
    }

    await delay(ACCOUNT_READY_POLL_MS);
  }

  throw new Error('Wallet setup is still confirming on Stellar. Please try again in a few seconds.');
}

async function horizonRequest<T = any>(path: string): Promise<T> {
  const response = await fetch(`${HORIZON_URL}${path}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.detail || body.title || 'Stellar network unavailable');
  }

  return body as T;
}

export async function relayerRequest<T = any>(
  path: string,
  options: RequestInit = {},
  timeoutMs: number = RELAYER_TIMEOUT_MS
): Promise<T> {
  if (!RELAYER_URL) {
    throw new RelayerRequestError('Payment service URL is not configured for this build.', {
      code: 'RELAYER_URL_MISSING',
    });
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  const optionHeaders = (options.headers || {}) as Record<string, string>;

  const headers = {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...optionHeaders,
  };

  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    attempt++;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    let body: any = {};

    try {
      response = await fetch(`${RELAYER_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers,
      });

      body = await response.json().catch(() => ({})) as RelayerErrorBody;

      if (!response.ok) {
        // Retry on cold-start-shaped failures (502, 503, 504)
        if ([502, 503, 504].includes(response.status) && attempt < maxAttempts) {
          await delay(2000 * attempt); // Backoff: 2s, 4s...
          continue;
        }

        throw new RelayerRequestError(body.error || 'Payment service unavailable', {
          status: response.status,
          code: body.code,
          retryAfterSeconds: normalizeRetryAfterSeconds(body.retryAfterSeconds),
          details: body,
        });
      }

      return body as T;
    } catch (error: any) {
      clearTimeout(timeout);

      // If it's a timeout or network error, maybe retry if we haven't exhausted attempts
      const isAbort = error?.name === 'AbortError';
      if (attempt < maxAttempts) {
        await delay(2000 * attempt);
        continue;
      }

      if (isAbort) {
        throw new RelayerRequestError('Payment service is taking too long to respond. Please try again.', {
          code: 'RELAYER_TIMEOUT',
        });
      }

      // If it was already thrown by us, rethrow
      if (error instanceof RelayerRequestError) {
        throw error;
      }

      throw new RelayerRequestError(
        `Payment service is not reachable. Check your internet connection and relayer URL (${RELAYER_URL}).`,
        { code: 'RELAYER_UNREACHABLE' }
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new RelayerRequestError('Payment service failed after multiple attempts.');
}

function normalizeRetryAfterSeconds(value: unknown): number {
  const seconds = Number(value || 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
