import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, SHADOWS, createThemedStyles } from '../../constants/theme';
import { formatWalletFingerprint } from '../../utils/cpayId';
import { AlertManager } from '../../utils/alert';
import { getMediaLibraryDownloadErrorMessage, requestPhotoSavePermission } from '../../utils/mediaLibrary';
import { InitialAvatar } from '../InitialAvatar';
import { Logger } from '../../utils/logger';
import { PROFILE } from '../../utils/strings';

interface ProfileQRCodeProps {
  profilePhoto: string | null;
  displayName: string;
  cpayId: string;
  walletAddress: string;
}

export const ProfileQRCode: React.FC<ProfileQRCodeProps> = ({
  profilePhoto,
  displayName,
  cpayId,
  walletAddress,
}) => {
  const styles = getStyles();
  const [showQRCode, setShowQRCode] = useState<boolean>(false);
  const qrCodeRef = useRef<any>(null);

  const handleShowQRCode = () => setShowQRCode((current) => !current);

  const handleShareQRCode = async () => {
    try {
      if (!qrCodeRef.current) return;
      const uri = await qrCodeRef.current.capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: PROFILE.QR_DIALOG_TITLE,
          UTI: 'public.png',
        });
      } else {
        AlertManager.alert('Not Available', 'Sharing is not available on this device');
      }
    } catch (error) {
      Logger.error('Error sharing QR code:', error);
      AlertManager.alert('Error', 'Failed to share QR code', undefined, { type: 'error' });
    }
  };

  const handleDownloadQRCode = async () => {
    try {
      const hasPermission = await requestPhotoSavePermission();
      if (!hasPermission) {
        AlertManager.alert('Permission Required', 'Please allow access to save the QR code to your gallery.');
        return;
      }
      if (qrCodeRef.current) {
        const uri = await qrCodeRef.current.capture();
        await MediaLibrary.createAssetAsync(uri);
        AlertManager.alert('Saved', 'QR code saved to your gallery.', undefined, { type: 'success' });
      }
    } catch (error) {
      Logger.error('Error downloading QR code:', error);
      AlertManager.alert('Error', getMediaLibraryDownloadErrorMessage(error), undefined, { type: 'error' });
    }
  };

  return (
    <View style={styles.section}>
      <TouchableOpacity style={styles.qrCodeCard} onPress={handleShowQRCode} activeOpacity={0.8}>
        <View style={styles.qrCodeHeader}>
          <View style={styles.qrCodeHeaderLeft}>
            <Ionicons name="qr-code-outline" size={24} color={COLORS.primary} style={styles.qrCodeIcon} />
            <Text style={styles.qrCodeTitle}>My QR Code</Text>
          </View>
          <Ionicons name={showQRCode ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.textMuted} />
        </View>

        {showQRCode && (
          <View style={styles.qrCodeContent}>
            <ViewShot ref={qrCodeRef} options={{ format: 'png', quality: 1.0 }}>
              <View style={styles.shareableQRCard}>
                <View style={styles.shareCardProfile}>
                  {profilePhoto ? (
                    <Image source={{ uri: profilePhoto }} style={styles.shareCardProfilePhoto} />
                  ) : (
                    <InitialAvatar name={displayName || 'User'} id={walletAddress} size={70} style={styles.shareCardProfilePhoto} />
                  )}
                  {!!displayName && <Text style={styles.shareCardName}>{displayName}</Text>}
                  <Text style={styles.shareCardAddress}>{cpayId || formatWalletFingerprint(walletAddress)}</Text>
                </View>

                <View style={styles.qrCodeWrapper}>
                  <QRCode
                    value={JSON.stringify({ type: 'cryptopay', recipient: walletAddress, amount: '0', name: displayName || 'C-Pay User' })}
                    size={220}
                    backgroundColor="white"
                    color={COLORS.primary}
                    logo={require('../../../assets/cpay_logo.png')}
                    logoSize={45}
                    logoBackgroundColor="white"
                    logoMargin={2}
                  />
                </View>

                <View style={styles.shareCardFooter}>
                  <Text style={styles.shareCardFooterText}>{PROFILE.QR_SHARE_CARD_FOOTER}</Text>
                </View>
              </View>
            </ViewShot>
            <Text style={styles.qrCodeDescription}>
              {PROFILE.QR_SHARE_INSTRUCTION}
            </Text>

            <View style={styles.qrActionButtons}>
              <TouchableOpacity style={styles.qrActionButton} onPress={handleDownloadQRCode}>
                <Ionicons name="download-outline" size={20} color={COLORS.text} />
                <Text style={styles.qrActionButtonText}>Download</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.qrActionButton, styles.qrShareButton]} onPress={handleShareQRCode}>
                <Ionicons name="share-social-outline" size={20} color={COLORS.textInverse} />
                <Text style={[styles.qrActionButtonText, styles.shareButtonText]}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
};

const getStyles = () => createThemedStyles((COLORS) => ({
  section: {
    marginBottom: SPACING.xl,
  },
  qrCodeCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  qrCodeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  qrCodeHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  qrCodeIcon: {
    marginRight: SPACING.sm,
  },
  qrCodeTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.text,
  },
  qrCodeContent: {
    alignItems: 'center',
    marginTop: SPACING.lg,
  },
  shareableQRCard: {
    backgroundColor: COLORS.surface,
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    width: 320,
  },
  shareCardProfile: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  shareCardProfilePhoto: {
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
    borderColor: COLORS.primary,
    marginBottom: SPACING.sm,
  },
  shareCardName: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  shareCardAddress: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  shareCardFooter: {
    marginTop: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  shareCardFooterText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  qrCodeWrapper: {
    padding: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    ...SHADOWS.md,
  },
  qrCodeDescription: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
  },
  qrActionButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
    width: '100%',
    paddingHorizontal: SPACING.md,
  },
  qrActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: SPACING.xs,
    ...SHADOWS.sm,
  },
  qrShareButton: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  qrActionButtonText: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: COLORS.text,
  },
  shareButtonText: {
    color: COLORS.textInverse,
  },
}));
