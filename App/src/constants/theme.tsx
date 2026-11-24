import React, { createContext, useContext, useMemo } from 'react';
import {
  StyleSheet,
  useColorScheme,
  type ColorSchemeName,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

// All application colors live here. Components consume semantic names so the
// same UI can render correctly in both operating-system color schemes.
export const LIGHT_COLORS = {
  primary: '#2563EB',
  primaryDark: '#1E40AF',
  primaryLight: '#DBEAFE',
  primaryGradient: ['#2563EB', '#0F766E'] as const,
  secondary: '#0F766E',
  accent: '#C2410C',
  success: '#047857',
  successLight: '#D1FAE5',
  successDark: '#065F46',
  successBg: '#ECFDF5',
  error: '#B91C1C',
  errorLight: '#FEE2E2',
  errorDark: '#7F1D1D',
  errorBg: '#FEF2F2',
  warning: '#B45309',
  warningLight: '#FEF3C7',
  warningDark: '#78350F',
  warningBg: '#FFFBEB',
  info: '#0369A1',
  infoLight: '#E0F2FE',
  infoDark: '#0C4A6E',
  infoBg: '#F0F9FF',
  background: '#F6F8FB',
  backgroundDark: '#E5E7EB',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  card: '#FFFFFF',
  cardHover: '#F1F5F9',
  border: '#CBD5E1',
  borderLight: '#E2E8F0',
  borderDark: '#94A3B8',
  text: '#111827',
  textPrimary: '#111827',
  textMuted: '#475569',
  textSecondary: '#475569',
  textTertiary: '#64748B',
  textDisabled: '#94A3B8',
  textInverse: '#FFFFFF',
  overlay: 'rgba(15, 23, 42, 0.64)',
  overlayLight: 'rgba(15, 23, 42, 0.40)',
  overlayStrong: 'rgba(0, 0, 0, 0.70)',
  whiteOverlaySubtle: 'rgba(255, 255, 255, 0.15)',
  whiteOverlayFaint: 'rgba(255, 255, 255, 0.18)',
  whiteOverlay: 'rgba(255, 255, 255, 0.20)',
  whiteOverlayQuarter: 'rgba(255, 255, 255, 0.25)',
  whiteOverlayMedium: 'rgba(255, 255, 255, 0.30)',
  whiteOverlayStrong: 'rgba(255, 255, 255, 0.40)',
  textOnBrandMuted: 'rgba(255, 255, 255, 0.85)',
  textOnBrandStrong: 'rgba(255, 255, 255, 0.90)',
  textOnBrandSubtle: 'rgba(255, 255, 255, 0.82)',
  textShadow: 'rgba(0, 0, 0, 0.10)',
  successOverlay: 'rgba(5, 150, 105, 0.90)',
  warningOverlay: 'rgba(217, 119, 6, 0.90)',
  errorOverlay: 'rgba(220, 38, 38, 0.90)',
  qrBackground: '#FFFFFF',
  shadow: '#000000',
  transactionIncoming: '#047857',
  transactionTransfer: '#7C3AED',
  transactionIncomingBg: 'rgba(5, 150, 105, 0.15)',
  transactionPendingBg: 'rgba(217, 119, 6, 0.15)',
  transactionFailedBg: 'rgba(220, 38, 38, 0.15)',
  transactionTransferBg: 'rgba(124, 58, 237, 0.15)',
  successGradient: ['#047857', '#059669', '#065F46'] as const,
  errorGradient: ['#DC2626', '#B91C1C', '#991B1B'] as const,
} as const;

export type ThemeColors = {
  -readonly [Key in keyof typeof LIGHT_COLORS]: (typeof LIGHT_COLORS)[Key] extends readonly string[]
    ? readonly [string, string, ...string[]]
    : string;
};

export const DARK_COLORS: ThemeColors = {
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  primaryLight: '#172554',
  primaryGradient: ['#2563EB', '#0F766E'],
  secondary: '#2DD4BF',
  accent: '#FB923C',
  success: '#34D399',
  successLight: '#064E3B',
  successDark: '#A7F3D0',
  successBg: '#052E26',
  error: '#F87171',
  errorLight: '#7F1D1D',
  errorDark: '#FECACA',
  errorBg: '#450A0A',
  warning: '#FBBF24',
  warningLight: '#713F12',
  warningDark: '#FDE68A',
  warningBg: '#422006',
  info: '#38BDF8',
  infoLight: '#0C4A6E',
  infoDark: '#BAE6FD',
  infoBg: '#082F49',
  background: '#0B1120',
  backgroundDark: '#020617',
  surface: '#111827',
  surfaceElevated: '#1F2937',
  card: '#111827',
  cardHover: '#1E293B',
  border: '#475569',
  borderLight: '#334155',
  borderDark: '#64748B',
  text: '#F8FAFC',
  textPrimary: '#F8FAFC',
  textMuted: '#CBD5E1',
  textSecondary: '#CBD5E1',
  textTertiary: '#94A3B8',
  textDisabled: '#64748B',
  textInverse: '#FFFFFF',
  overlay: 'rgba(2, 6, 23, 0.76)',
  overlayLight: 'rgba(2, 6, 23, 0.56)',
  overlayStrong: 'rgba(0, 0, 0, 0.82)',
  whiteOverlaySubtle: 'rgba(255, 255, 255, 0.15)',
  whiteOverlayFaint: 'rgba(255, 255, 255, 0.18)',
  whiteOverlay: 'rgba(255, 255, 255, 0.20)',
  whiteOverlayQuarter: 'rgba(255, 255, 255, 0.25)',
  whiteOverlayMedium: 'rgba(255, 255, 255, 0.30)',
  whiteOverlayStrong: 'rgba(255, 255, 255, 0.40)',
  textOnBrandMuted: 'rgba(255, 255, 255, 0.85)',
  textOnBrandStrong: 'rgba(255, 255, 255, 0.90)',
  textOnBrandSubtle: 'rgba(255, 255, 255, 0.82)',
  textShadow: 'rgba(0, 0, 0, 0.10)',
  successOverlay: 'rgba(5, 150, 105, 0.90)',
  warningOverlay: 'rgba(217, 119, 6, 0.90)',
  errorOverlay: 'rgba(220, 38, 38, 0.90)',
  qrBackground: '#FFFFFF',
  shadow: '#000000',
  transactionIncoming: '#34D399',
  transactionTransfer: '#A78BFA',
  transactionIncomingBg: 'rgba(52, 211, 153, 0.18)',
  transactionPendingBg: 'rgba(251, 191, 36, 0.18)',
  transactionFailedBg: 'rgba(248, 113, 113, 0.18)',
  transactionTransferBg: 'rgba(167, 139, 250, 0.18)',
  successGradient: ['#047857', '#059669', '#065F46'],
  errorGradient: ['#DC2626', '#B91C1C', '#991B1B'],
};

export const SPACING = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64 };

export const TYPOGRAPHY = {
  sizes: { xs: 11, sm: 12, md: 14, base: 16, lg: 18, xl: 20, xxl: 24, xxxl: 32, display: 40 },
  weights: {
    light: '300' as const,
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
  },
  lineHeights: { tight: 1.2, normal: 1.5, relaxed: 1.75 },
};

export const FONT_SIZES = TYPOGRAPHY.sizes;
export const BORDER_RADIUS = { none: 0, xs: 4, sm: 8, md: 10, lg: 12, xl: 16, xxl: 20, full: 9999 };

type NamedStyles<T> = { [Key in keyof T]: ViewStyle | TextStyle | ImageStyle };
let activeScheme: 'light' | 'dark' = 'light';
let activeColors: ThemeColors = LIGHT_COLORS;

// Backward-compatible access for inline color references. The proxy resolves
// against the active provider palette at render time.
export const COLORS = new Proxy({} as ThemeColors, {
  get: (_target, property) => activeColors[property as keyof ThemeColors],
});

export const createThemedStyles = <T extends NamedStyles<T> | NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & NamedStyles<any>,
): T => {
  const cache: Partial<Record<'light' | 'dark', T>> = {};
  return new Proxy({} as T, {
    get: (_target, property) => {
      if (!cache[activeScheme]) {
        cache[activeScheme] = StyleSheet.create(factory(activeColors)) as T;
      }
      return cache[activeScheme]?.[property as keyof T];
    },
  });
};

export const SHADOWS = createThemedStyles((colors) => ({
  none: { shadowColor: 'transparent', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  sm: { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  md: { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 3 },
  lg: { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 5 },
  xl: { shadowColor: colors.shadow, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 8 },
}));

export const ANIMATION = {
  duration: { fast: 150, normal: 250, slow: 350 },
  easing: { ease: 'ease', easeIn: 'ease-in', easeOut: 'ease-out', easeInOut: 'ease-in-out' },
};

export const BLOCKCHAIN_CONFIG = {
  NETWORK: process.env.EXPO_PUBLIC_STELLAR_NETWORK || 'testnet',
  HORIZON_URL: process.env.EXPO_PUBLIC_STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
  RELAYER_URL: process.env.EXPO_PUBLIC_STELLAR_RELAYER_URL || '',
  USDC_ASSET_CODE: 'USDC',
  USDC_ASSET_ISSUER:
    process.env.EXPO_PUBLIC_USDC_ASSET_ISSUER ||
    (process.env.EXPO_PUBLIC_STELLAR_NETWORK === 'public'
      ? 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
      : 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'),
  EXPLORER_URL: process.env.EXPO_PUBLIC_STELLAR_EXPLORER_URL || 'https://stellar.expert/explorer/testnet',
};

type ThemeContextValue = { colorScheme: 'light' | 'dark'; colors: ThemeColors; isDark: boolean };
const ThemeContext = createContext<ThemeContextValue>({ colorScheme: 'light', colors: LIGHT_COLORS, isDark: false });

export const ThemeProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const systemScheme: ColorSchemeName = useColorScheme();
  const colorScheme = systemScheme === 'dark' ? 'dark' : 'light';
  const colors = colorScheme === 'dark' ? DARK_COLORS : LIGHT_COLORS;

  // Set before rendering descendants so legacy inline references and themed
  // style sheets resolve to the same palette as the context.
  activeScheme = colorScheme;
  activeColors = colors;

  const value = useMemo(
    () => ({ colorScheme, colors, isDark: colorScheme === 'dark' }),
    [colorScheme, colors],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);
export const useThemedStyles = <T extends NamedStyles<T> | NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & NamedStyles<any>,
): T => {
  const { colors } = useTheme();
  return useMemo(() => StyleSheet.create(factory(colors)) as T, [colors, factory]);
};
export const getGradient = (colors: readonly string[]) => ({ colors, start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });

export const theme = {
  colors: COLORS,
  spacing: SPACING,
  typography: TYPOGRAPHY,
  borderRadius: BORDER_RADIUS,
  shadows: SHADOWS,
  animation: ANIMATION,
};

export default theme;
