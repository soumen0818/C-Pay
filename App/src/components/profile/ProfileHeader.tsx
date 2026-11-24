import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, useThemedStyles, type ThemeColors } from '../../constants/theme';
import { formatWalletFingerprint } from '../../utils/cpayId';
import { AlertManager } from '../../utils/alert';
import { InitialAvatar } from '../InitialAvatar';
import { Logger } from '../../utils/logger';

interface ProfileHeaderProps {
  profilePhoto: string | null;
  displayName: string;
  cpayId: string;
  walletAddress: string;
  setProfilePhoto: (uri: string) => void;
  uploadProfilePhoto: (uri: string) => Promise<string | null>;
}

export const ProfileHeader: React.FC<ProfileHeaderProps> = ({
  profilePhoto,
  displayName,
  cpayId,
  walletAddress,
  setProfilePhoto,
  uploadProfilePhoto,
}) => {
  const styles = useThemedStyles(getStyles);

  const handlePickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        AlertManager.alert('Permission Required', 'Please allow access to your photos to change your profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (!result.canceled && result.assets[0]) {
        const photoUri = result.assets[0].uri;
        AlertManager.alert('Uploading', 'Uploading your profile photo...');
        const uploaded = await uploadProfilePhoto(photoUri);
        if (uploaded) {
          setProfilePhoto(uploaded);
          AlertManager.alert('Success', 'Profile photo updated and synced to cloud!', undefined, { type: 'success' });
        } else {
          setProfilePhoto(photoUri);
          await AsyncStorage.setItem('profile_photo', photoUri);
          AlertManager.alert('Saved Locally', 'Photo saved on device. Cloud sync unavailable.');
        }
      }
    } catch (error) {
      Logger.error('Error picking image:', error);
      AlertManager.alert('Error', 'Failed to update profile photo', undefined, { type: 'error' });
    }
  };

  const handleCopyAddress = async () => {
    const idToCopy = cpayId || formatWalletFingerprint(walletAddress);
    await Clipboard.setStringAsync(idToCopy);
    AlertManager.alert('Copied', 'Your C-Pay ID was copied to the clipboard.', undefined, { type: 'success' });
  };

  return (
    <View style={styles.profileHeader}>
      <TouchableOpacity
        style={styles.profilePhotoContainer}
        onPress={handlePickImage}
        accessibilityRole="button"
        accessibilityLabel={profilePhoto ? 'Change profile photo' : 'Add profile photo'}
      >
        {profilePhoto ? (
          <Image source={{ uri: profilePhoto }} style={styles.profilePhoto} />
        ) : (
          <InitialAvatar name={displayName || 'User'} id={walletAddress} size={100} style={styles.profilePhoto} />
        )}
        <View style={styles.editIconContainer}>
          <Ionicons name="camera-outline" size={15} color={COLORS.primary} />
        </View>
      </TouchableOpacity>

      {!!displayName && <Text style={styles.profileName}>{displayName}</Text>}
      <TouchableOpacity
        style={styles.addressContainer}
        onPress={handleCopyAddress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Copy C-Pay ID ${cpayId || formatWalletFingerprint(walletAddress)}`}
      >
        <Text style={styles.profileAddress}>{cpayId || formatWalletFingerprint(walletAddress)}</Text>
        <Ionicons name="copy-outline" size={20} color={COLORS.primary} />
      </TouchableOpacity>
    </View>
  );
};

const getStyles = (COLORS: ThemeColors) => ({
  profileHeader: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
    paddingVertical: SPACING.lg,
  },
  profilePhotoContainer: {
    position: 'relative',
    marginBottom: SPACING.md,
  },
  profilePhoto: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    borderColor: COLORS.primary,
  },
  editIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderRadius: 15,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  profileName: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  profileAddress: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    flex: 1,
    marginRight: SPACING.sm,
  },
});
