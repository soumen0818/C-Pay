import React from 'react';
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BLOCKCHAIN_CONFIG, COLORS, SPACING, FONT_SIZES, BORDER_RADIUS, createThemedStyles, useTheme } from '../constants/theme';
import { formatMoneyAmount } from '../utils/currency';
import { PILOT_NOTICE_TEXT } from '../utils/pilot';
import { Button } from './Button';

export interface PaymentReviewSheetProps {
  visible: boolean;
  /** Resolved recipient display name (may be empty if unknown). */
  recipientName?: string;
  /** C-Pay ID or wallet fingerprint shown under the name. */
  cpayId: string;
  /** Amount in user-visible USDC units, as a string. */
  amount: string;
  note?: string;
  /** Stellar network id (defaults to the configured network). */
  network?: string;
  /** True while authenticating / submitting — locks the sheet and shows the CTA spinner. */
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const formatNetworkLabel = (network: string): string => {
  if (!network) return 'Stellar Testnet';
  const normalized = network.trim().toLowerCase();
  if (normalized === 'testnet') return 'Stellar Testnet';
  if (normalized === 'public' || normalized === 'mainnet') return 'Stellar Mainnet';
  return `Stellar ${network.charAt(0).toUpperCase()}${network.slice(1)}`;
};

/**
 * Dedicated payment review sheet shown before wallet unlock. Used by both
 * manual send and scan-to-pay so every payment is confirmed with the same
 * trusted summary: recipient identity, C-Pay ID, amount, note, network,
 * payment type and fee sponsorship state.
 */
export const PaymentReviewSheet: React.FC<PaymentReviewSheetProps> = ({
  visible,
  recipientName,
  cpayId,
  amount,
  note,
  network = BLOCKCHAIN_CONFIG.NETWORK,
  submitting = false,
  onConfirm,
  onCancel,
}) => {
  useTheme();
  const insets = useSafeAreaInsets();
  const amountNum = parseFloat(amount);
  const hasAmount = !!amount && !isNaN(amountNum) && amountNum > 0;

  const handleBackdrop = () => {
    if (!submitting) onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleBackdrop}
      accessibilityViewIsModal
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleBackdrop}>
        <TouchableOpacity
          activeOpacity={1}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, SPACING.lg) }]}
          onPress={() => {}}
        >
          <View style={styles.grabber} />
          <Text style={styles.title}>Review payment</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Recipient identity */}
            <View style={styles.identityCard}>
              <View style={[styles.identityIcon, styles.identityIconPerson]}>
                <Ionicons
                  name="person"
                  size={24}
                  color={COLORS.primary}
                />
              </View>
              <View style={styles.identityText}>
                <Text style={styles.identityLabel}>
                  Sending to
                </Text>
                <Text style={styles.identityName} numberOfLines={1}>
                  {recipientName || 'Recipient'}
                </Text>
                <Text style={styles.identityId} numberOfLines={1}>
                  {cpayId}
                </Text>
              </View>
            </View>

            {/* Amount */}
            <View
              style={styles.amountBlock}
              accessible
              accessibilityLabel={`Amount: ${hasAmount ? formatMoneyAmount(amountNum) : 'not set'}`}
            >
              <Text style={styles.amountLabel} importantForAccessibility="no-hide-descendants">Amount</Text>
              <Text
                style={styles.amountValue}
                importantForAccessibility="no"
                // Cap scaling so large-text mode keeps the amount on one line
                maxFontSizeMultiplier={1.2}
              >
                {hasAmount ? formatMoneyAmount(amountNum) : '—'}
              </Text>
            </View>

            {/* Detail rows */}
            <View style={styles.detailCard}>
              <DetailRow
                icon="swap-horizontal-outline"
                label="Payment type"
                value="Personal transfer"
              />
              <View style={styles.detailDivider} />
              <DetailRow
                icon="globe-outline"
                label="Network"
                value={formatNetworkLabel(network)}
              />
              <View style={styles.detailDivider} />
              <DetailRow
                icon="shield-checkmark-outline"
                label="Network fee"
                value="Sponsored by C-Pay"
                valueColor={COLORS.success}
              />
              {!!note && (
                <>
                  <View style={styles.detailDivider} />
                  <DetailRow icon="document-text-outline" label="Note" value={note} />
                </>
              )}
            </View>

            {/* Pilot / safety notice */}
            <View style={styles.notice}>
              <Ionicons name="flask-outline" size={16} color={COLORS.info} style={styles.noticeIcon} />
              <Text style={styles.noticeText}>{PILOT_NOTICE_TEXT}</Text>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Button
              title="Confirm & Pay"
              onPress={onConfirm}
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={submitting || !hasAmount}
            />
            <Button
              title="Cancel"
              onPress={onCancel}
              variant="ghost"
              size="md"
              fullWidth
              disabled={submitting}
              style={styles.cancelButton}
            />
          </View>

          <Text style={styles.unlockHint}>
            You'll confirm with your PIN or biometrics next.
          </Text>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const DetailRow: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  valueColor?: string;
}> = ({ icon, label, value, valueColor }) => (
  <View style={styles.detailRow}>
    <Ionicons name={icon} size={18} color={COLORS.textMuted} style={styles.detailIcon} />
    <Text style={styles.detailLabel}>{label}</Text>
    <Text style={[styles.detailValue, valueColor ? { color: valueColor } : null]} numberOfLines={2}>
      {value}
    </Text>
  </View>
);

const styles = createThemedStyles((COLORS) => ({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xxl,
    borderTopRightRadius: BORDER_RADIUS.xxl,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    maxHeight: '88%',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: SPACING.sm,
  },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  identityIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  identityIconPerson: {
    backgroundColor: COLORS.primaryLight,
  },
  identityText: {
    flex: 1,
  },
  identityLabel: {
    fontSize: FONT_SIZES.xs,
    fontWeight: '600',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  identityName: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: COLORS.text,
  },
  identityId: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  amountBlock: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    marginBottom: SPACING.md,
  },
  amountLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  amountValue: {
    fontSize: FONT_SIZES.xxxl,
    fontWeight: '800',
    color: COLORS.text,
  },
  detailCard: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  detailIcon: {
    marginRight: SPACING.sm,
  },
  detailLabel: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textMuted,
  },
  detailValue: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'right',
  },
  detailDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.border,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.infoBg,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
  },
  noticeIcon: {
    marginRight: SPACING.sm,
    marginTop: 1,
  },
  noticeText: {
    flex: 1,
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    lineHeight: 19,
  },
  actions: {
    marginTop: SPACING.md,
  },
  cancelButton: {
    marginTop: SPACING.xs,
  },
  unlockHint: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textTertiary,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
}));
