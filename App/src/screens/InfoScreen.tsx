import React from 'react';

// Info screen: educational and support details for wallet users.
import { View, Text, StyleSheet, Linking } from 'react-native';
import { COLORS, SPACING, FONT_SIZES, createThemedStyles, useTheme } from '../constants/theme';
import { Screen, Header, Button, InfoBanner } from '../components';
import { AlertManager } from '../utils/alert';
import { INFO_DOCS, INFO_SUPPORT_EMAIL, type InfoDoc } from '../utils/strings';

export type { InfoDoc };

interface InfoScreenProps {
  navigation: any;
  route: { params?: { doc?: InfoDoc } };
}

export const InfoScreen: React.FC<InfoScreenProps> = ({ navigation, route }) => {
  useTheme();
  const doc = route.params?.doc || 'about';
  const { title, blocks } = INFO_DOCS[doc] || INFO_DOCS.about;

  const handleEmailSupport = async () => {
    const url = `mailto:${INFO_SUPPORT_EMAIL}?subject=${encodeURIComponent('C-Pay support')}`;
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        AlertManager.alert('Email', `Reach us at ${INFO_SUPPORT_EMAIL}`);
      }
    } catch {
      AlertManager.alert('Email', `Reach us at ${INFO_SUPPORT_EMAIL}`);
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
          <Button title={`Email ${INFO_SUPPORT_EMAIL}`} onPress={handleEmailSupport} variant="primary" size="lg" fullWidth />
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
