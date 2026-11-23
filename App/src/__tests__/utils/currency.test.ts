import {
  formatMoneyAmount,
  formatMoneyBalance,
  formatMoneyNumber,
  MONEY_UNIT_LABEL,
  STELLAR_AMOUNT_DECIMALS,
} from '../../utils/currency';

describe('USDC formatting', () => {
  test('uses USDC as the display currency', () => {
    expect(MONEY_UNIT_LABEL).toBe('USDC');
    expect(formatMoneyAmount(100)).toBe('100.00 USDC');
  });

  test('shows cents for ordinary amounts', () => {
    expect(formatMoneyNumber(12)).toBe('12.00');
    expect(formatMoneyBalance('12.5')).toBe('12.50');
  });

  test('preserves meaningful precision through seven decimals', () => {
    expect(STELLAR_AMOUNT_DECIMALS).toBe(7);
    expect(formatMoneyAmount('0.0000001')).toBe('0.0000001 USDC');
    expect(formatMoneyNumber('1.2345678')).toBe('1.2345678');
  });

  test('rounds only the displayed eighth decimal', () => {
    expect(formatMoneyNumber('1.23456785')).toBe('1.2345679');
  });

  test('handles non-finite values without throwing', () => {
    expect(formatMoneyAmount(NaN)).toBe('0.00 USDC');
    expect(formatMoneyAmount(Infinity)).toBe('0.00 USDC');
  });
});
