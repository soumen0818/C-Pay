import { Logger } from '../utils/logger';
import React, { useState, useEffect, useRef } from 'react';

// Email verification screen: validates ownership and login access.
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  clearCachedAccountData,
  sendLoginEmailOTP,
  verifyLoginEmailOTP,
  getRemainingAttempts,
  WALLET_AUTH_USER_ID_KEY,
} from '../services/auth';
import { hasWallet } from '../services/wallet';
import { supabase } from '../services/supabase';
import { COLORS, SPACING, TYPOGRAPHY, BORDER_RADIUS, SHADOWS, createThemedStyles, useTheme } from '../constants/theme';
import { AlertManager } from '../utils/alert';
import { OnboardingProgress, Screen, FormField, InfoBanner, Button } from '../components';
import {
  PILOT_ACCESS_REQUIRED,
  PILOT_NOTICE_TEXT,
  PILOT_NOTICE_TITLE,
  isPilotAccessCodeValid,
} from '../utils/pilot';

const FONT_SIZES = TYPOGRAPHY.sizes;
const { width, height } = Dimensions.get('window');
const isSmallDevice = height < 700;
const EMAIL_OTP_LENGTH = 8;
const OTP_DIGITS = Array.from({ length: EMAIL_OTP_LENGTH }, (_, index) => index);
const OTP_BOX_GAP = isSmallDevice ? 4 : 6;
const OTP_CARD_HORIZONTAL_PADDING = isSmallDevice ? SPACING.sm : SPACING.md;
const OTP_BOX_SIZE = Math.min(
  isSmallDevice ? 38 : 42,
  Math.floor((width - SPACING.lg * 2 - OTP_CARD_HORIZONTAL_PADDING * 2 - OTP_BOX_GAP * (EMAIL_OTP_LENGTH - 1)) / EMAIL_OTP_LENGTH)
);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_VERIFIED_KEY = 'email_verified';
const USER_EMAIL_KEY = 'user_email';

type ExistingUserProfile = {
  wallet_address: string;
  display_name?: string | null;
  profile_photo_url?: string | null;
};

interface EmailVerificationScreenProps {
  navigation: any;
}

export const EmailVerificationScreen: React.FC<EmailVerificationScreenProps> = ({
  navigation,
}) => {
  useTheme();
  const [emailAddress, setEmailAddress] = useState('');
  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState('');
  const [pilotAccessCode, setPilotAccessCode] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const [remainingAttempts, setRemainingAttempts] = useState(3);
  const [otpFocused, setOtpFocused] = useState(false);
  const otpInputRef = useRef<TextInput>(null);
  const verifyingRef = useRef(false);
  const lastSubmittedOtpRef = useRef<string | null>(null);

  useEffect(() => {
    loadRemainingAttempts();
  }, []);

  // Auto-focus OTP input when switching to OTP verification stage
  useEffect(() => {
    if (step === 'otp' && otpInputRef.current) {
      // Small delay to ensure the input is rendered
      setTimeout(() => {
        otpInputRef.current?.focus();
      }, 100);
    }
  }, [step]);

  useEffect(() => {
    if (step === 'otp' && timer > 0) {
      const interval = setInterval(() => {
        setTimer((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step, timer]);

  useEffect(() => {
    if (step === 'otp' && otp.length === EMAIL_OTP_LENGTH && !verifyingRef.current) {
      handleVerifyOTP();
    }
  }, [otp, step]);

  const handleOtpChange = (value: string) => {
    const nextOtp = value.replace(/\D/g, '').slice(0, EMAIL_OTP_LENGTH);
    lastSubmittedOtpRef.current = null;
    setOtp(nextOtp);
  };

  const resetOtpEntry = () => {
    setOtp('');
    setOtpFocused(false);
    lastSubmittedOtpRef.current = null;
  };

  const loadRemainingAttempts = async () => {
    const { remaining } = await getRemainingAttempts();
    setRemainingAttempts(remaining);
  };

  const loadExistingUserProfile = async (): Promise<ExistingUserProfile | null> => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      return null;
    }

    const { data, error } = await supabase
      .from('users')
      .select('wallet_address, display_name, profile_photo_url')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (error) {
      Logger.error('Existing profile lookup failed:', error);
      return null;
    }

    return data as ExistingUserProfile | null;
  };

  const handleSendOTP = async () => {
    const normalizedEmail = emailAddress.trim().toLowerCase();

    if (!EMAIL_REGEX.test(normalizedEmail)) {
      AlertManager.alert('Error', 'Please enter a valid email address');
      return;
    }

    if (PILOT_ACCESS_REQUIRED && !isPilotAccessCodeValid(pilotAccessCode)) {
      AlertManager.alert(
        'Pilot Access Required',
        'Enter the invite code shared for this closed pilot.'
      );
      return;
    }

    setLoading(true);
    setEmailAddress(normalizedEmail);

    const result = await sendLoginEmailOTP(normalizedEmail);

    if (result.success && result.verificationId) {
      setVerificationId(result.verificationId);
      resetOtpEntry();
      setStep('otp');
      setTimer(30);
      setCanResend(false);
      if (result.remainingAttempts !== undefined) {
        setRemainingAttempts(result.remainingAttempts);
      }
    } else {
      if (result.resetTime) {
        AlertManager.alert(
          'Device Limit Reached',
          result.error || "This device reached today's verification-code request limit across all email addresses."
        );
      } else {
        const isRateLimitError = /rate|limit|too many|security purposes|wait|requested/i.test(result.error || '');
        AlertManager.alert(
          isRateLimitError ? 'Email Limit Reached' : 'Error',
          result.error || 'Failed to send verification code'
        );
      }
      if (result.remainingAttempts !== undefined) {
        setRemainingAttempts(result.remainingAttempts);
      }
    }

    setLoading(false);
  };

  const handleVerifyOTP = async () => {
    if (verifyingRef.current) {
      return;
    }

    const otpToVerify = otp.trim();
    const submissionKey = `${verificationId}:${otpToVerify}`;

    if (lastSubmittedOtpRef.current === submissionKey) {
      return;
    }

    if (!otpToVerify || otpToVerify.length !== EMAIL_OTP_LENGTH) {
      AlertManager.alert('Error', `Please enter a valid ${EMAIL_OTP_LENGTH}-digit code`);
      return;
    }

    verifyingRef.current = true;
    lastSubmittedOtpRef.current = submissionKey;
    setLoading(true);

    const result = await verifyLoginEmailOTP(verificationId, otpToVerify);

    if (result.success) {
      const verifiedEmail = result.email || emailAddress.trim().toLowerCase();
      await AsyncStorage.multiSet([
        [EMAIL_VERIFIED_KEY, 'true'],
        [USER_EMAIL_KEY, verifiedEmail],
      ]);

      const existingProfile = await loadExistingUserProfile();
      const walletExists = await hasWallet();

      if (walletExists) {
        const localWalletAddress = await AsyncStorage.getItem('wallet_address');
        const walletOwnerId = await AsyncStorage.getItem(WALLET_AUTH_USER_ID_KEY);
        const { data: userData } = await supabase.auth.getUser();
        const verifiedUserId = userData.user?.id;
        const profileWalletMatches =
          !!localWalletAddress &&
          !!existingProfile?.wallet_address &&
          localWalletAddress === existingProfile.wallet_address;
        const ownerMatches = !walletOwnerId || walletOwnerId === verifiedUserId;

        if (profileWalletMatches && ownerMatches) {
          if (verifiedUserId && !walletOwnerId) {
            await AsyncStorage.setItem(WALLET_AUTH_USER_ID_KEY, verifiedUserId);
          }
          navigation.replace('Login');
        } else {
          await clearCachedAccountData();
          navigation.replace('RestoreWallet', {
            verifiedEmail,
            walletAddress: existingProfile?.wallet_address || localWalletAddress || '',
            displayName: existingProfile?.display_name || null,
            profilePhotoUrl: existingProfile?.profile_photo_url || null,
            accountSwitch: true,
          });
        }
      } else {
        if (existingProfile?.wallet_address) {
          navigation.replace('RestoreWallet', {
            verifiedEmail,
            walletAddress: existingProfile.wallet_address,
            displayName: existingProfile.display_name || null,
            profilePhotoUrl: existingProfile.profile_photo_url || null,
          });
          setLoading(false);
          verifyingRef.current = false;
          return;
        }

        navigation.replace('CreatePIN');
      }
    } else {
      AlertManager.alert('Error', result.error || 'Invalid OTP');
      resetOtpEntry();
    }

    setLoading(false);
    verifyingRef.current = false;
  };

  const handleResendOTP = () => {
    resetOtpEntry();
    setStep('email');
    setCanResend(false);
  };

  return (
    <Screen padded={false}>
          <OnboardingProgress currentStep={1} flowType="setup" />

          <View style={styles.content}>
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.logo}>
                <Ionicons name="mail-outline" size={isSmallDevice ? 30 : 38} color={COLORS.primary} />
              </View>
              <Text style={styles.title}>
                {step === 'email' ? 'Verify with Email' : 'Verify Email Code'}
              </Text>
              <Text style={styles.subtitle}>
                {step === 'email'
                  ? 'Enter your email address to continue'
                  : `Code sent to ${emailAddress}`}
              </Text>
            </View>

            {/* Rate Limit Indicator */}
            {remainingAttempts <= 3 && step === 'email' && (
              <InfoBanner
                variant="warning"
                icon={remainingAttempts === 0 ? 'alert-circle-outline' : 'speedometer-outline'}
                message={remainingAttempts === 0
                  ? 'Daily verification limit reached on this device'
                  : `${remainingAttempts} verification request${remainingAttempts > 1 ? 's' : ''} remaining today on this device`}
                style={styles.bannerSpacing}
              />
            )}

            {/* Input Section */}
            {step === 'email' ? (
              <View style={styles.inputSection}>
                <InfoBanner
                  variant="info"
                  icon="flask-outline"
                  title={PILOT_NOTICE_TITLE}
                  message={PILOT_NOTICE_TEXT}
                  style={styles.bannerSpacing}
                />

                {PILOT_ACCESS_REQUIRED && (
                  <FormField
                    containerStyle={styles.bannerSpacing}
                    value={pilotAccessCode}
                    onChangeText={setPilotAccessCode}
                    placeholder="Pilot invite code"
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                )}

                <FormField
                  containerStyle={styles.fieldSpacing}
                  leftIcon="mail-outline"
                  value={emailAddress}
                  onChangeText={setEmailAddress}
                  placeholder="Enter email address"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  maxLength={254}
                  autoFocus
                />

                <Button
                  title="Send Email Code"
                  onPress={handleSendOTP}
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={loading}
                  disabled={loading || remainingAttempts === 0}
                />
              </View>
            ) : (
              <View style={styles.inputSection}>
                <View
                  style={styles.otpInputCard}
                  accessibilityLabel="Enter verification code"
                >
                  <View style={styles.otpVisualLayer} pointerEvents="none">
                    <View style={styles.otpContainer}>
                      {OTP_DIGITS.map((index) => {
                        const isActive = !loading && otpFocused && (otp.length === index || (otp.length === EMAIL_OTP_LENGTH && index === EMAIL_OTP_LENGTH - 1));
                        const isFilled = Boolean(otp[index]);

                        return (
                          <View
                            key={index}
                            style={[
                              styles.otpBox,
                              isActive && styles.otpBoxFocused,
                              isFilled && styles.otpBoxFilled,
                              loading && styles.otpBoxDisabled,
                            ]}
                          >
                            <Text style={[
                              styles.otpDigit,
                              isFilled && styles.otpDigitFilled,
                            ]}>
                              {otp[index] || ''}
                            </Text>
                          </View>
                        );
                      })}
                    </View>

                    <View style={styles.otpStatusRow}>
                      <Text style={styles.otpHint}>
                        {loading
                          ? 'Verifying code...'
                          : otp.length === 0
                            ? `Waiting for ${EMAIL_OTP_LENGTH}-digit code`
                            : otp.length < EMAIL_OTP_LENGTH
                              ? `${EMAIL_OTP_LENGTH - otp.length} digit${EMAIL_OTP_LENGTH - otp.length === 1 ? '' : 's'} remaining`
                              : 'Code ready'}
                      </Text>
                      {loading && (
                        <ActivityIndicator size="small" color={COLORS.primary} />
                      )}
                    </View>
                  </View>

                  <TextInput
                    ref={otpInputRef}
                    style={styles.otpNativeInput}
                    value={otp}
                    onChangeText={handleOtpChange}
                    onFocus={() => setOtpFocused(true)}
                    onBlur={() => setOtpFocused(false)}
                    keyboardType="number-pad"
                    maxLength={EMAIL_OTP_LENGTH}
                    autoFocus
                    editable={!loading}
                    caretHidden
                    showSoftInputOnFocus
                    selectionColor="transparent"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    importantForAutofill="yes"
                    accessibilityLabel="Verification code"
                  />
                </View>

                {/* Timer and Resend */}
                <View style={styles.timerContainer}>
                  {timer > 0 ? (
                    <Text style={styles.timerText}>Resend code in {timer}s</Text>
                  ) : (
                    <TouchableOpacity onPress={handleResendOTP}>
                      <Text style={styles.resendText}>Resend code</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <Button
                  title="Verify Code"
                  onPress={handleVerifyOTP}
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={loading}
                  disabled={loading || otp.length !== EMAIL_OTP_LENGTH}
                />

                {/* Back button */}
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => {
                    setStep('email');
                    resetOtpEntry();
                  }}
                >
                  <Text style={styles.backButtonText}>Change Email</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Security Notice */}
            <View style={styles.securityNotice}>
              <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.textMuted} style={styles.securityIcon} />
              <Text style={styles.securityText}>
                Your email code confirms secure account access
              </Text>
            </View>
          </View>
    </Screen>
  );
};

const styles = createThemedStyles((COLORS) => ({
  content: {
    flex: 1,
    padding: SPACING.lg,
    paddingTop: isSmallDevice ? SPACING.xs : SPACING.md,
  },
  bannerSpacing: {
    marginBottom: SPACING.md,
  },
  fieldSpacing: {
    marginBottom: SPACING.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: isSmallDevice ? SPACING.md : SPACING.xl,
  },
  logo: {
    width: isSmallDevice ? 60 : 80,
    height: isSmallDevice ? 60 : 80,
    borderRadius: isSmallDevice ? 30 : 40,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  title: {
    fontSize: isSmallDevice ? FONT_SIZES.xl : FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: isSmallDevice ? FONT_SIZES.sm : FONT_SIZES.md,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  inputSection: {
    marginBottom: SPACING.xl,
  },
  otpInputCard: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.lg,
    paddingHorizontal: OTP_CARD_HORIZONTAL_PADDING,
    paddingVertical: isSmallDevice ? SPACING.md : SPACING.lg,
    marginBottom: SPACING.sm,
    minHeight: isSmallDevice ? 110 : 122,
    position: 'relative',
    ...SHADOWS.sm,
  },
  otpVisualLayer: {
    flex: 1,
    justifyContent: 'center',
  },
  otpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: OTP_BOX_GAP,
    marginBottom: SPACING.md,
  },
  otpBox: {
    width: OTP_BOX_SIZE,
    height: OTP_BOX_SIZE + 8,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxFocused: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: COLORS.primaryLight + '18',
  },
  otpBoxFilled: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '0F',
  },
  otpBoxDisabled: {
    opacity: 0.72,
  },
  otpDigit: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  otpDigitFilled: {
    color: COLORS.primary,
  },
  otpNativeInput: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    color: 'transparent',
    backgroundColor: 'transparent',
    fontSize: 1,
    lineHeight: 1,
    padding: 0,
  },
  otpStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  otpHint: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  timerContainer: {
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  timerText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
  },
  resendText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.primary,
    fontWeight: '600',
  },
  backButton: {
    marginTop: SPACING.md,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.primary,
    fontWeight: '500',
  },
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.xl,
  },
  securityIcon: {
    marginRight: SPACING.sm,
  },
  securityText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
    flex: 1,
  },
}));
