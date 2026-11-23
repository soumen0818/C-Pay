export const MONEY_SYMBOL = '$';
export const MONEY_UNIT_LABEL = 'USDC';
export const MONEY_BALANCE_LABEL = 'USDC Balance';
export const STELLAR_AMOUNT_DECIMALS = 7;

function safeAmount(amount: string | number): number {
  const parsed = typeof amount === 'string' ? Number(amount) : amount;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Display at least cents and reveal meaningful precision up to Stellar's
 * seven-decimal limit. This rounds only the displayed value; signed payment
 * amounts are validated separately and are never silently rounded.
 */
export function formatMoneyNumber(amount: string | number): string {
  return safeAmount(amount).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: STELLAR_AMOUNT_DECIMALS,
  });
}

export function formatMoneyAmount(amount: string | number): string {
  return `${formatMoneyNumber(amount)} USDC`;
}

export function formatMoneyBalance(amount: string | number): string {
  return formatMoneyNumber(amount);
}
