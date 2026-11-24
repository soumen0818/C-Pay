import { Logger } from '../utils/logger';
import React, { useRef, useState } from 'react';

// Profile setup screen: helps complete user identity for the wallet.
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../services/supabase';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { Button, OnboardingProgress, FormField, InfoBanner } from '../components';
import { AlertManager } from '../utils/alert';
import { generateCPayId } from '../utils/cpayId';

interface ProfileSetupScreenProps {
  navigation: any;
  route: any;
}

export const ProfileSetupScreen: React.FC<ProfileSetupScreenProps> = ({ navigation, route }) => {
  useTheme();
  const { walletAddress, walletReplacement = false, cpayId: existingCPayId } = route.params;
  const [fullName, setFullName] = useState('');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const completingRef = useRef(false);

  const handlePickImage = async () => {
    try {
      // Request permission - system will show dialog automatically
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        return; // User denied permission - system already showed dialog
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (!result.canceled && result.assets[0]) {
        setProfilePhoto(result.assets[0].uri);
      }
    } catch (error) {
      Logger.error('Error picking image:', error);
    }
  };

  const uploadProfilePhoto = async (photoUri: string, address: string): Promise<string | null> => {
    try {
      Logger.info('Uploading profile photo...');

      // Read file as base64
      const base64 = await fetch(photoUri)
        .then(res => res.blob())
        .then(blob => {
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64data = reader.result as string;
              resolve(base64data.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        });

      const fileExt = photoUri.split('.').pop()?.split('?')[0] || 'jpg';
      const fileName = `${address.substring(0, 8)}_${Date.now()}.${fileExt}`;
      const filePath = `profile-photos/${fileName}`;

      // Convert base64 to array buffer
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('profile-images')
        .upload(filePath, bytes.buffer, {
          contentType: `image/${fileExt}`,
          upsert: true,
        });

      if (uploadError) {
        Logger.error('Upload error:', uploadError);
        return null;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('profile-images')
        .getPublicUrl(filePath);

      return urlData.publicUrl;
    } catch (error) {
      Logger.error('Error uploading photo:', error);
      return null;
    }
  };

  const completeProfileSetup = async (
    name: string,
    emailToSave: string | null,
    cpayId: string,
    photoUri: string | null
  ): Promise<void> => {
    let photoUrl: string | null = null;

    if (photoUri) {
      photoUrl = await uploadProfilePhoto(photoUri, walletAddress);
      if (photoUrl) {
        await AsyncStorage.setItem('profile_photo', photoUrl);
      }
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const authUserId = sessionData.session?.user.id || null;

    const { error: dbError } = await supabase
      .from('users')
      .upsert(
        {
          auth_user_id: authUserId,
          wallet_address: walletAddress,
          display_name: name,
          email: emailToSave,
          cpay_id: cpayId,
          profile_photo_url: photoUrl,
        },
        { onConflict: 'wallet_address' }
      );

    if (dbError) {
      Logger.error('Database error:', dbError);
    }
  };

  const handleComplete = async () => {
    const trimmedName = fullName.trim();

    if (completingRef.current) {
      return;
    }

    if (!trimmedName) {
      AlertManager.alert('Name Required', 'Please enter your full name to continue.', undefined, { type: 'warning' });
      return;
    }

    try {
      completingRef.current = true;
      setLoading(true);

      const emailToSave = await AsyncStorage.getItem('user_email');

      // Generate a public C-Pay ID for display and receiving payments.
      const cpayId = walletReplacement && existingCPayId
        ? existingCPayId
        : generateCPayId(emailToSave || '', walletAddress);

      // Save locally
      const localWrites = [
        AsyncStorage.setItem('display_name', trimmedName),
        AsyncStorage.setItem('cpay_id', cpayId),
        AsyncStorage.setItem('profile_complete', 'true'),
        AsyncStorage.setItem('cloud_backup_required', 'true'),
        AsyncStorage.setItem('cloud_backup_complete', 'false'),
      ];

      if (profilePhoto) {
        localWrites.push(AsyncStorage.setItem('profile_photo', profilePhoto));
      }

      await Promise.all(localWrites);

      // Complete profile upload/cloud save here so the next screen opens cleanly.
      await completeProfileSetup(trimmedName, emailToSave, cpayId, profilePhoto);

      // Cloud backup protects the wallet before optional biometric setup.
      navigation.replace('CloudBackupSetup');
    } catch (error) {
      Logger.error('Profile setup error:', error);
      completingRef.current = false;
      setLoading(false);
      AlertManager.alert('Error', 'Failed to save profile. Please try again.', undefined, { type: 'error' });
    }
  };


  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <OnboardingProgress currentStep={3} flowType="setup" />
        <LinearGradient
          colors={[COLORS.primary, COLORS.primaryDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <View style={styles.headerIcon}>
            <Ionicons name="person-outline" size={38} color={COLORS.textInverse} />
          </View>
          <Text style={styles.title}>Complete Your Profile</Text>
          <Text style={styles.subtitle}>
            Add the name people will see when they pay you.
          </Text>
        </LinearGradient>

        <View style={styles.content}>
          {/* Profile Photo Section */}
          <View style={styles.section}>
            <Text style={styles.label}>
              Profile Photo <Text style={styles.optional}>(Optional)</Text>
            </Text>
            <TouchableOpacity
              style={styles.photoContainer}
              onPress={handlePickImage}
              activeOpacity={0.8}
              disabled={loading}
            >
              {profilePhoto ? (
                <Image source={{ uri: profilePhoto }} style={styles.photo} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Ionicons name="camera-outline" size={30} color={COLORS.textMuted} style={styles.photoPlaceholderIcon} />
                  <Text style={styles.photoPlaceholderText}>Add Photo</Text>
                </View>
              )}
            </TouchableOpacity>
            {profilePhoto && (
              <TouchableOpacity
                onPress={() => setProfilePhoto(null)}
                style={styles.removePhotoButton}
                disabled={loading}
              >
                <Text style={styles.removePhotoText}>Remove Photo</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Full Name Section */}
          <FormField
            containerStyle={styles.section}
            label="Full Name *"
            value={fullName}
            onChangeText={setFullName}
            placeholder="Enter your full name"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={50}
            editable={!loading}
            helper="This name will be visible to other users"
          />

          {/* Info Card */}
          <InfoBanner
            variant="info"
            icon="shield-checkmark-outline"
            title="Your Information is Secure"
            message="Your profile details are encrypted and stored securely. We never share your personal information."
            style={styles.infoCard}
          />

          <Button
            title={loading ? 'Saving Profile...' : 'Complete Setup'}
            onPress={handleComplete}
            disabled={loading}
            loading={loading}
            fullWidth
            size="lg"
          />

          {loading && (
            <Text style={styles.loadingText}>
              Saving your profile before cloud backup...
            </Text>
          )}

          <Text style={styles.footer}>
            By continuing, you agree to our Terms of Service and Privacy Policy
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = createThemedStyles((COLORS) => ({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : SPACING.xl,
    paddingBottom: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  headerIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.whiteOverlayFaint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: COLORS.textInverse,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textInverse,
    opacity: 0.9,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: SPACING.lg,
  },
  section: {
    marginBottom: SPACING.xl,
  },
  label: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  required: {
    color: COLORS.error,
  },
  optional: {
    color: COLORS.textMuted,
    fontWeight: '400',
  },
  photoContainer: {
    alignSelf: 'center',
    marginBottom: SPACING.sm,
  },
  photo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.surface,
  },
  photoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  photoPlaceholderIcon: {
    marginBottom: SPACING.xs,
  },
  photoPlaceholderText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  removePhotoButton: {
    alignSelf: 'center',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
  },
  removePhotoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.error,
    fontWeight: '600',
  },
  infoCard: {
    marginBottom: SPACING.xl,
  },
  footer: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.md,
  },
  loadingText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
}));
