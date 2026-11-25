import React from 'react';

// Onboarding screen: welcome and product education for first-time users.
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, TYPOGRAPHY, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { Button, Screen, BottomActionBar } from '../components';
import { PILOT_TESTNET_TEXT } from '../utils/pilot';
import { ONBOARDING } from '../utils/strings';

const FONT_SIZES = TYPOGRAPHY.sizes;
const { height } = Dimensions.get('window');
const isSmallDevice = height < 700;

interface OnboardingScreenProps {
  navigation: any;
}

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ navigation }) => {
  useTheme();
  const handleGetStarted = () => {
    navigation.navigate('EmailVerification');
  };

  return (
    <Screen
      footer={
        <BottomActionBar>
          <Button title="Get Started" onPress={handleGetStarted} size="lg" fullWidth />
          <Text style={styles.disclaimer}>
            {PILOT_TESTNET_TEXT}
          </Text>
        </BottomActionBar>
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Image
          source={require('../../assets/cpay_logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>C-Pay</Text>
        <Text style={styles.subtitle}>{ONBOARDING.SUBTITLE}</Text>
      </View>

      {/* Features */}
      <View style={styles.featuresContainer}>
        <FeatureItem
          icon="shield-checkmark-outline"
          title="Secure & Private"
          description="Your wallet, your keys. All data encrypted locally."
        />
        <FeatureItem
          icon="flash-outline"
          title="Instant Payments"
          description="Scan QR, tap pay. Transactions in seconds."
        />
        <FeatureItem
          icon="card-outline"
          title="No Fee Hassle"
          description={ONBOARDING.NO_FEE_DESC}
        />
        <FeatureItem
          icon="qr-code-outline"
          title="Simple UX"
          description="Scan, authenticate, done. Just like UPI."
        />
      </View>
    </Screen>
  );
};

interface FeatureItemProps {
  icon: string;
  title: string;
  description: string;
}

const FeatureItem: React.FC<FeatureItemProps> = ({ icon, title, description }) => (
  <View style={styles.featureItem}>
    <View style={styles.featureIcon}>
      <Ionicons name={icon as any} size={22} color={COLORS.primary} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureDescription}>{description}</Text>
    </View>
  </View>
);

const styles = createThemedStyles((COLORS) => ({
  header: {
    alignItems: 'center',
    marginBottom: isSmallDevice ? SPACING.sm : SPACING.lg,
  },
  logo: {
    width: isSmallDevice ? 72 : 96,
    height: isSmallDevice ? 72 : 96,
    borderRadius: isSmallDevice ? 36 : 48,
    marginBottom: isSmallDevice ? SPACING.sm : SPACING.md,
  },
  title: {
    fontSize: isSmallDevice ? FONT_SIZES.xl : FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: isSmallDevice ? FONT_SIZES.xs : FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  featuresContainer: {
    paddingBottom: SPACING.sm,
  },
  featureItem: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: isSmallDevice ? SPACING.sm : SPACING.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  featureIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primaryLight,
    marginRight: SPACING.md,
  },
  featureTitle: {
    fontSize: isSmallDevice ? FONT_SIZES.sm : FONT_SIZES.md,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  featureDescription: {
    fontSize: isSmallDevice ? FONT_SIZES.xs : FONT_SIZES.sm,
    color: COLORS.textMuted,
    lineHeight: isSmallDevice ? 16 : 18,
  },
  disclaimer: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
}));
