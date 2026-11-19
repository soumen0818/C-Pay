import React from 'react';

// Info screen: educational and support details for wallet users.
import { View, Text, StyleSheet, Linking } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, createThemedStyles, useTheme } from '../constants/theme';
import { Screen, Header, Button, InfoBanner } from '../components';
import { AlertManager } from '../utils/alert';

export type InfoDoc = 'privacy' | 'terms' | 'about' | 'support';

interface InfoScreenProps {
  navigation: any;
  route: { params?: { doc?: InfoDoc } };
}

const SUPPORT_EMAIL = 'support@cpay.app';
const APP_VERSION = '1.0.3';

type Block =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string };

const CONTENT: Record<InfoDoc, { title: string; blocks: Block[] }> = {
  about: {
    title: 'About C-Pay',
    blocks: [
      { type: 'paragraph', text: `C-Pay v${APP_VERSION}` },
      { type: 'paragraph', text: 'C-Pay is a closed-pilot payment app that uses test credits on the Stellar testnet. It lets you send and receive pilot credits.' },
      { type: 'paragraph', text: 'Pilot credits are for testing only. They are not real money, hold no cash value, and cannot be redeemed.' },
      { type: 'paragraph', text: '© 2026 C-Pay. All rights reserved.' },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    blocks: [
      { type: 'heading', text: 'What we store' },
      { type: 'paragraph', text: 'C-Pay stores your display name, C-Pay ID, optional profile photo, and verified email. Your wallet is encrypted on your device; an optional encrypted backup can be stored to help you recover it.' },
      { type: 'heading', text: 'Your keys' },
      { type: 'paragraph', text: 'Your PIN and private keys never leave your device unencrypted. C-Pay cannot read or recover your PIN or secret key. Cloud backups are encrypted with a recovery password only you know.' },
      { type: 'heading', text: 'Payments' },
      { type: 'paragraph', text: 'Pilot payments are recorded on the Stellar testnet, which is public. Transaction amounts, addresses, and timestamps are visible on-chain.' },
      { type: 'heading', text: 'Account deletion' },
      { type: 'paragraph', text: 'You can delete your account at any time from your Profile screen. Deleting your account permanently deletes your profile, C-Pay ID, verified email, and encrypted cloud backups from our servers, unlinking all server associations immediately.' },
      { type: 'heading', text: 'Contact' },
      { type: 'paragraph', text: `For privacy questions, email ${SUPPORT_EMAIL}.` },
    ],
  },
  terms: {
    title: 'Terms of Service',
    blocks: [
      { type: 'heading', text: 'Pilot program' },
      { type: 'paragraph', text: 'C-Pay is provided for a closed pilot on the Stellar testnet. Pilot credits are test-only, have no monetary value, and may be reset or removed at any time.' },
      { type: 'heading', text: 'Your responsibilities' },
      { type: 'paragraph', text: 'You are responsible for keeping your PIN, recovery password, and exported keys private. Anyone with these can control your wallet. C-Pay cannot reverse payments or recover lost keys.' },
      { type: 'heading', text: 'No warranty' },
      { type: 'paragraph', text: 'The pilot is provided “as is” without warranties. Service may be interrupted or discontinued.' },
      { type: 'heading', text: 'Contact' },
      { type: 'paragraph', text: `Questions about these terms? Email ${SUPPORT_EMAIL}.` },
    ],
  },
  support: {
    title: 'Help & Support',
    blocks: [
      { type: 'heading', text: 'Getting started' },
      { type: 'paragraph', text: 'Send credits from the Home or Send screen using a C-Pay ID or by scanning a QR code. You confirm every payment with your PIN or biometrics before it is sent.' },
      { type: 'heading', text: 'Recovering your wallet' },
      { type: 'paragraph', text: 'Set up cloud backup in the Security Center so you can restore your wallet on a new device with your recovery password. You can also export your secret key as a backup.' },
      { type: 'heading', text: 'Common issues' },
      { type: 'paragraph', text: 'If a payment fails, your credits are not deducted — check your connection and try again.' },
    ],
  },
};

export const InfoScreen: React.FC<InfoScreenProps> = ({ navigation, route }) => {
  useTheme();
  const doc = route.params?.doc || 'about';
  const { title, blocks } = CONTENT[doc];

  const handleEmailSupport = async () => {
    const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('C-Pay support')}`;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        AlertManager.alert('Email', `Reach us at ${SUPPORT_EMAIL}`);
      }
    } catch {
      AlertManager.alert('Email', `Reach us at ${SUPPORT_EMAIL}`);
    }
  };

  return (
    <Screen header={<Header title={title} onBack={() => navigation.goBack()} />}>
      {blocks.map((block, index) =>
        block.type === 'heading' ? (
          <Text key={index} style={styles.heading}>
            {block.text}
          </Text>
        ) : (
          <Text key={index} style={styles.paragraph}>
            {block.text}
          </Text>
        )
      )}

      {doc === 'support' && (
        <View style={styles.supportActions}>
          <Button title={`Email ${SUPPORT_EMAIL}`} onPress={handleEmailSupport} variant="primary" size="lg" fullWidth />
        </View>
      )}

      {(doc === 'privacy' || doc === 'terms') && (
        <InfoBanner
          variant="info"
          message="This summary is provided for the closed pilot and is not a substitute for legal advice."
          style={styles.note}
        />
      )}
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  heading: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: SPACING.lg,
    marginBottom: SPACING.xs,
  },
  paragraph: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
    lineHeight: 22,
    marginBottom: SPACING.sm,
  },
  supportActions: {
    marginTop: SPACING.xl,
  },
  note: {
    marginTop: SPACING.xl,
  },
}));
