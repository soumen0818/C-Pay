import React from 'react';

// Profile screen: wallet identity, photo, and account settings.
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { Screen, Section, ActionRow } from '../components';
import { ProfileHeader, ProfileQRCode } from '../components/profile';
import { useProfileData } from '../hooks/useProfileData';
import { AlertManager } from '../utils/alert';
import { clearSessionPin } from '../services/wallet';
interface ProfileScreenProps {
  navigation: any;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({ navigation }) => {
  useTheme();
  const {
    walletAddress,
    cpayId,
    displayName,
    profilePhoto,
    setProfilePhoto,
    uploadProfilePhoto,
  } = useProfileData();

  const handleSignOut = () => {
    AlertManager.alert(
      'Sign Out',
      'Are you sure you want to sign out? You will need email verification and wallet unlock to access your account again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem('auth_token');
            await AsyncStorage.removeItem('phone_verified');
            await AsyncStorage.removeItem('phone_number');
            await AsyncStorage.removeItem('user_phone');
            await AsyncStorage.removeItem('email_verified');
            await AsyncStorage.removeItem('user_email');
            clearSessionPin();
            AlertManager.alert('Signed Out', 'You have been signed out successfully.', [
              { text: 'OK', onPress: () => navigation.replace('Splash') },
            ]);
          },
        },
      ]
    );
  };

  return (
    <Screen topInset={false}>
      <ProfileHeader
        profilePhoto={profilePhoto}
        displayName={displayName}
        cpayId={cpayId}
        walletAddress={walletAddress}
        setProfilePhoto={setProfilePhoto}
        uploadProfilePhoto={uploadProfilePhoto}
      />
      <ProfileQRCode
        profilePhoto={profilePhoto}
        displayName={displayName}
        cpayId={cpayId}
        walletAddress={walletAddress}
      />

      {/* Security — kept near the top so security actions aren't buried */}
      <Section title="Security">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="shield-checkmark-outline"
            title="Security Center"
            subtitle="PIN, biometrics, backup, wallet keys"
            onPress={() => navigation.navigate('SecurityCenter')}
          />
        </View>
      </Section>

      {/* Wallet */}
      <Section title="Wallet">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="receipt-outline"
            title="Transaction history"
            subtitle="View all your payments"
            onPress={() => navigation.navigate('TransactionHistory')}
          />
        </View>
      </Section>

      {/* Support */}
      <Section title="Support">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="chatbubble-ellipses-outline"
            title="Help & Support"
            subtitle="Guides and contact options"
            onPress={() => navigation.navigate('Info', { doc: 'support' })}
          />
        </View>
      </Section>

      {/* Legal */}
      <Section title="Legal">
        <View style={styles.card}>
          <ActionRow
            style={styles.rowFlat}
            icon="lock-closed-outline"
            title="Privacy Policy"
            onPress={() => navigation.navigate('Info', { doc: 'privacy' })}
          />
          <View style={styles.divider} />
          <ActionRow
            style={styles.rowFlat}
            icon="document-text-outline"
            title="Terms of Service"
            onPress={() => navigation.navigate('Info', { doc: 'terms' })}
          />
          <View style={styles.divider} />
          <ActionRow
            style={styles.rowFlat}
            icon="information-circle-outline"
            title="About"
            onPress={() => navigation.navigate('Info', { doc: 'about' })}
          />
        </View>
      </Section>

      {/* Sign out */}
      <View style={styles.signOutSection}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={20} color={COLORS.error} style={styles.signOutButtonIcon} />
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>
        <Text style={styles.signOutHint}>Your wallet will be safe. Sign back in anytime.</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>C-Pay v1.0.3</Text>
        <Text style={styles.footerSubtext}>Built for closed-pilot test payments</Text>
        <Text style={styles.footerSubtext}>Stellar Testnet</Text>
      </View>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
  },
  rowFlat: {
    backgroundColor: 'transparent',
    borderRadius: 0,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.sm,
  },
  signOutSection: {
    marginBottom: SPACING.xl,
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.error + '15',
    borderWidth: 1,
    borderColor: COLORS.error,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
  },
  signOutButtonIcon: {
    marginRight: SPACING.sm,
  },
  signOutButtonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.error,
  },
  signOutHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  footer: {
    alignItems: 'center',
    marginTop: SPACING.xl,
    paddingTop: SPACING.xl,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  footerText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  footerSubtext: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
  },
}));
