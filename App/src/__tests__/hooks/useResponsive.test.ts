let memoFn = (fn: any) => fn();

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useMemo: (fn: any) => fn(),
}));

import { useResponsive, BREAKPOINTS } from '../../hooks/useResponsive';
import { useWindowDimensions } from 'react-native';

describe('C-010: useResponsive hook', () => {
  const mockedDimensions = useWindowDimensions as jest.Mock;

  test('computes layout properties for small phone (< 360)', () => {
    mockedDimensions.mockReturnValue({ width: 320, height: 568 });
    const responsive = useResponsive();

    expect(responsive.width).toBe(320);
    expect(responsive.height).toBe(568);
    expect(responsive.isSmall).toBe(true);
    expect(responsive.isLarge).toBe(false);
    expect(responsive.isTablet).toBe(false);
    expect(responsive.maxContentWidth).toBe(320);
    expect(responsive.scale(20)).toBeLessThanOrEqual(20);
  });

  test('computes layout properties for standard phone (375-390)', () => {
    mockedDimensions.mockReturnValue({ width: 390, height: 844 });
    const responsive = useResponsive();

    expect(responsive.isSmall).toBe(false);
    expect(responsive.isLarge).toBe(false);
    expect(responsive.isTablet).toBe(false);
    expect(responsive.scale(20)).toBe(20);
  });

  test('computes layout properties for large phone (>= 414)', () => {
    mockedDimensions.mockReturnValue({ width: 428, height: 926 });
    const responsive = useResponsive();

    expect(responsive.isSmall).toBe(false);
    expect(responsive.isLarge).toBe(true);
    expect(responsive.isTablet).toBe(false);
  });

  test('computes layout properties for tablet (>= 600)', () => {
    mockedDimensions.mockReturnValue({ width: 768, height: 1024 });
    const responsive = useResponsive();

    expect(responsive.isTablet).toBe(true);
    expect(responsive.maxContentWidth).toBe(560);
  });
});
