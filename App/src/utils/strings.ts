/**
 * C-Pay localization catalog.
 *
 * All user-facing strings live here so the app has a single source of truth
 * and is ready for a full i18n runtime (e.g. i18next) without any refactor.
 *
 * Convention:
 *   - Keys are SCREAMING_SNAKE_CASE strings grouped by feature area.
 *   - Parameterized strings are plain functions that accept an object and
 *     return a string.  No template-tag magic is needed yet.
 *   - Import individual keys rather than the whole object to keep bundles
 *     tree-shakeable.
 */

// ─── Accessibility ────────────────────────────────────────────────────────────

export const A11Y = {
  // Navigation
  GO_BACK: 'Go back',
  CLOSE: 'Close',
  CLOSE_MODAL: 'Close modal',
  OPEN_MENU: 'Open menu',

  // Actions
  COPY: 'Copy',
  SHARE: 'Share',
  DOWNLOAD: 'Download',
  SCAN_QR: 'Scan QR code',
  VIEW_IN_EXPLORER: 'View in Stellar explorer',

  // Form / input
  PIN_INPUT: 'PIN input',
  AMOUNT_INPUT: 'Amount input',
  SEARCH_INPUT: 'Search',
  RECIPIENT_INPUT: 'Recipient address or C-Pay ID',
  NOTE_INPUT: 'Payment note (optional)',

  // Buttons
  CONFIRM_PAYMENT: 'Confirm payment',
  CANCEL_PAYMENT: 'Cancel payment',
  SEND_USDC: 'Send USDC',
  CLAIM_USDC: 'Claim testnet USDC',
  VIEW_HISTORY: 'View transaction history',
  ADD_MONEY: 'Add money',

  // Status / badges (read by screen readers instead of color-only cues)
  STATUS_CONFIRMED: 'Status: Confirmed',
  STATUS_PENDING: 'Status: Pending',
  STATUS_SUBMITTED: 'Status: Submitted',
  STATUS_FAILED: 'Status: Failed',
  STATUS_UNKNOWN: 'Status: Unknown',

  // Transaction list items
  TRANSACTION_ITEM: (params: { direction: string; counterparty: string; amount: string; status: string }) =>
    `${params.direction} ${params.amount} ${params.direction === 'Received from' ? 'from' : 'to'} ${params.counterparty}. ${params.status}`,

  // QR
  USER_QR_CODE: 'Your personal C-Pay QR code',

  // Quick-amount chips
  QUICK_AMOUNT: (amount: string) => `Set amount to ${amount}`,

  // Profile photo
  PROFILE_PHOTO: (name: string) => `Profile photo for ${name}`,
};

// ─── Onboarding ───────────────────────────────────────────────────────────────

export const ONBOARDING = {
  WELCOME_TITLE: 'Welcome to C-Pay',
  WELCOME_SUBTITLE: 'UPI-style payments on Stellar',
  SUBTITLE: 'Closed pilot on Stellar testnet',
  GET_STARTED: 'Get Started',
  ALREADY_HAVE_ACCOUNT: 'Already have an account? Sign in',
  FEATURE_SECURE: 'Secure',
  FEATURE_SECURE_DESC: 'Your wallet is encrypted on device',
  FEATURE_FAST: 'Fast',
  FEATURE_FAST_DESC: 'Payments settle in seconds on Stellar',
  FEATURE_SIMPLE: 'Simple',
  FEATURE_SIMPLE_DESC: 'QR codes and C-Pay IDs — no addresses',
  NO_FEE_DESC: 'Network fees are handled for you. You test payments with testnet USDC.',
};

// ─── Authentication ───────────────────────────────────────────────────────────

export const AUTH = {
  EMAIL_LABEL: 'Email address',
  EMAIL_PLACEHOLDER: 'you@example.com',
  SEND_CODE: 'Send code',
  ENTER_CODE: 'Enter verification code',
  RESEND_CODE: 'Resend code',
  CODE_SENT: (email: string) => `Verification code sent to ${email}`,
  CODE_LABEL: 'Verification code',
  SIGN_OUT: 'Sign out',
  SIGN_OUT_CONFIRM: 'Are you sure you want to sign out?',
  SIGN_OUT_CONFIRM_YES: 'Sign out',
  SIGN_OUT_CONFIRM_NO: 'Cancel',
};

// ─── PIN ──────────────────────────────────────────────────────────────────────

export const PIN = {
  CREATE_TITLE: 'Create your PIN',
  CREATE_SUBTITLE: 'Your 6-digit PIN protects your wallet',
  CONFIRM_TITLE: 'Confirm your PIN',
  CONFIRM_SUBTITLE: 'Enter your PIN again to confirm',
  ENTER_TITLE: 'Enter your PIN',
  CHANGE_TITLE: 'Change PIN',
  CURRENT_PIN_LABEL: 'Current PIN',
  NEW_PIN_LABEL: 'New PIN',
  CONFIRM_PIN_LABEL: 'Confirm new PIN',
  PINS_DONT_MATCH: 'PINs do not match. Please try again.',
  WRONG_PIN: 'Incorrect PIN. Please try again.',
  CHANGE_SUCCESS: 'PIN changed successfully',
};

// ─── Home ─────────────────────────────────────────────────────────────────────

export const HOME = {
  BALANCE_CARD_HINT: 'Your current balance',
  PILOT_ONLY_HINT: 'Testnet USDC only — no monetary value',
  RECENT_TRANSACTIONS: 'Recent Transactions',
  SEE_ALL: 'See All',
  NO_TRANSACTIONS_TITLE: 'No Transactions Yet',
  NO_TRANSACTIONS_DESC: 'Your transaction history will appear here',
  REFRESH_HINT: 'Pull to refresh your balance and transactions',
  SEND_USDC: 'Send USDC',
  ADD_MONEY_DISABLED_HINT: 'Add money coming soon through a licensed partner',
  CLAIM_BUTTON: 'Claim Testnet USDC',
  CLAIM_BUTTON_CLAIMING: 'Claiming Testnet USDC',
  CLAIM_BUTTON_SUCCESS: 'Testnet USDC Added',
  CLAIM_BUTTON_FAILED: 'Testnet USDC Claim Failed',
  CLAIM_CHECKING: 'Checking Claim',
  CLAIM_AUTH_REQUIRED: 'Authentication Required',
  CLAIM_AVAILABLE: 'Testnet USDC is available now. You can claim again.',
  CLAIM_COOLDOWN: (time: string) => `You can claim testnet USDC again in ${time}.`,
  CLAIM_WAIT_24H: 'Please wait 24 hours between testnet USDC claims.',
  CLAIM_DISTRIBUTION_EMPTY: 'Testnet USDC claims are temporarily unavailable because the relayer distribution account has no test asset balance.',
  CLAIM_ACCOUNT_NOT_READY: 'Wallet setup could not finish yet. Please try again in a few seconds.',
  CLAIM_DISABLED_NETWORK: 'Testnet USDC claims are disabled for this network.',
  CLAIM_WALLET_OWNERSHIP_DENIED: 'Your wallet does not match your account. Sign out, sign back in, and try again.',
  CLAIM_FAILED_FALLBACK: 'Failed to claim testnet USDC',
  ADD_MONEY_PREPARING: 'Preparing your wallet on Stellar testnet and adding testnet USDC...',
  ADD_MONEY_CLAIM_MSG: (amount: string) => `Claim ${amount} for testnet use. One claim is available every 24 hours.`,
  ADD_MONEY_SUCCESS_MSG: (amount: string) => `${amount} has been added. Your balance will refresh automatically.`,
};

// ─── Payments ─────────────────────────────────────────────────────────────────

export const PAYMENT = {
  SEND_TITLE: 'Send USDC',
  RECIPIENT_LABEL: 'To (C-Pay ID or wallet address)',
  RECIPIENT_PLACEHOLDER: 'username@cpay…',
  AMOUNT_LABEL: 'Amount',
  NOTE_LABEL: 'Note (optional)',
  NOTE_PLACEHOLDER: 'What is this for?',
  REVIEW_TITLE: 'Review payment',
  CONFIRM_AND_PAY: 'Confirm & Pay',
  CANCEL: 'Cancel',
  SENDING_TO: 'Sending to',
  NETWORK_FEE_SPONSORED: 'Sponsored by C-Pay',
  UNLOCK_HINT: "You'll confirm with your PIN or biometrics next.",
  SUCCESS_TITLE: 'Payment Sent',
  FAILURE_TITLE: 'Payment Failed',
  PROCESSING_TITLE: 'Processing Payment',
  AUTH_PIN_PROMPT: 'Enter your 6-digit PIN to send testnet USDC',
  AUTH_BIOMETRIC_PROMPT: 'Unlock wallet to send testnet USDC',
  CANNOT_SEND_TO_SELF: 'You cannot send testnet USDC to yourself',
};

// ─── Transactions ─────────────────────────────────────────────────────────────

export const TRANSACTION = {
  HISTORY_TITLE: 'Transactions',
  DETAILS_TITLE: 'Transaction Details',
  TYPE_SENT: 'Sent',
  TYPE_RECEIVED: 'Received',
  TYPE_PAYMENT_RECEIVED: 'Payment Received',
  STATUS_CONFIRMED: 'Confirmed',
  STATUS_PENDING: 'Pending',
  STATUS_SUBMITTED: 'Submitted',
  STATUS_FAILED: 'Failed',
  COPY_HASH_HINT: 'Copy transaction hash',
  OPEN_EXPLORER_HINT: 'Open in Stellar explorer',
  COPY_FROM_HINT: 'Copy sender ID',
  COPY_TO_HINT: 'Copy recipient ID',
  DONE: 'Done',
  DATE_TIME_LABEL: 'Date & Time',
  FROM_LABEL: 'From',
  TO_LABEL: 'To',
  TYPE_LABEL: 'Type',
  METHOD_LABEL: 'Payment Method',
  NOTE_LABEL: 'Note',
  HASH_LABEL: 'Transaction Hash',
};

// ─── Profile ──────────────────────────────────────────────────────────────────

export const PROFILE = {
  TITLE: 'Profile',
  WALLET_ADDRESS_LABEL: 'Wallet Address',
  CPAY_ID_LABEL: 'C-Pay ID',
  DISPLAY_NAME_LABEL: 'Display Name',
  COPY_ADDRESS_HINT: 'Copy wallet address',
  COPY_CPAY_ID_HINT: 'Copy C-Pay ID',
  SHOW_QR: 'Show QR code',
  HIDE_QR: 'Hide QR code',
  EDIT_PHOTO: 'Change profile photo',
  SECURITY_SECTION: 'Security',
  PREFERENCES_SECTION: 'Preferences',
  SIGN_OUT: 'Sign out',
  CHANGE_PIN: 'Change PIN',
  BIOMETRIC_LABEL: 'Biometric unlock',
  NOTIFICATIONS_LABEL: 'Notifications',
  QR_DIALOG_TITLE: 'Scan this QR code to send me testnet USDC on C-Pay.',
  QR_SHARE_CARD_FOOTER: 'Scan to send testnet USDC',
  QR_SHARE_INSTRUCTION: 'Let others scan this QR code to send you testnet USDC',
  FOOTER_PILOT: 'Built for closed-pilot test payments',
};

// ─── Forgot PIN ───────────────────────────────────────────────────────────────

export const FORGOT_PIN = {
  TITLE: 'Reset PIN',
  BIOMETRIC_UNAVAILABLE_TITLE: 'Biometrics Unavailable',
  BIOMETRIC_UNAVAILABLE_DESC: 'Biometric authentication is not enabled on this device. You can restore your wallet from your cloud backup.',
  NO_BACKUP_TITLE: 'No Biometric Backup',
  NO_BACKUP_DESC: 'This wallet was created without biometric backup. You can restore your wallet using your cloud backup recovery password.',
  RESTORE_CLOUD_BUTTON: 'Restore from Cloud Backup',
};

// ─── Info ─────────────────────────────────────────────────────────────────────

export const INFO = {
  ABOUT_TITLE: 'About C-Pay',
  ABOUT_DESC_1: 'C-Pay is a closed-pilot payment app on the Stellar testnet. It lets you send and receive testnet USDC.',
  ABOUT_DESC_2: 'Testnet USDC is for testing only. It is not real money, holds no cash value, and cannot be redeemed.',
  TERMS_PILOT_DESC: 'C-Pay is provided for a closed pilot on the Stellar testnet. Testnet USDC is test-only, has no monetary value, and may be reset or removed at any time.',
  SUPPORT_SEND_DESC: 'Send testnet USDC from the Home or Send screen using a C-Pay ID or by scanning a QR code. You confirm every payment with your PIN or biometrics before it is sent.',
  SUPPORT_FAIL_DESC: 'If a payment fails, your funds are not deducted — check your connection and try again.',
};

// ─── Payment Failure ──────────────────────────────────────────────────────────

export const PAYMENT_FAILURE = {
  SUGGESTION_CLAIM_USDC: 'Claim testnet USDC for your wallet',
};

// ─── QR ───────────────────────────────────────────────────────────────────────

export const QR = {
  SCAN_TITLE: 'Scan QR Code',
  SCAN_HINT: 'Point camera at a C-Pay QR code',
  GENERATE_TITLE: 'My QR Code',
  AMOUNT_QR_TITLE: 'Payment QR',
  DOWNLOAD_SUCCESS: 'QR code saved to your photos',
  DOWNLOAD_FAILED: 'Failed to save QR code',
  SHARE_TITLE: 'Share QR code',
  SCAN_BUTTON: 'Scan to Pay',
  SHOW_QR_BUTTON: 'Show QR',
  CREATE_QR_BUTTON: 'Create QR',
};

// ─── Wallet Backup & Restore ──────────────────────────────────────────────────

export const BACKUP = {
  SETUP_TITLE: 'Back up your wallet',
  SETUP_SUBTITLE: 'Set a recovery password to restore your wallet if you lose your device',
  RECOVERY_PASSWORD_LABEL: 'Recovery password',
  RECOVERY_PASSWORD_CONFIRM_LABEL: 'Confirm recovery password',
  CREATE_BACKUP: 'Create Backup',
  RESTORE_TITLE: 'Restore Wallet',
  RESTORE_SUBTITLE: 'Enter your recovery password to restore your wallet',
  RESTORE_BUTTON: 'Restore Wallet',
  RULES_LENGTH: 'At least 12 characters',
  RULES_UPPERCASE: 'At least 1 uppercase letter',
  RULES_NUMBER: 'At least 1 number',
  RULES_SPECIAL: 'At least 1 special character',
};

// ─── Status / feedback ────────────────────────────────────────────────────────

export const STATUS = {
  LOADING: 'Loading…',
  SAVING: 'Saving…',
  ERROR_GENERIC: 'Something went wrong. Please try again.',
  SUCCESS_GENERIC: 'Done',
  RETRY: 'Try Again',
  DISMISS: 'Dismiss',
  NETWORK_ERROR: 'No internet connection. Please check your network.',
  TRY_AGAIN: 'Try Again',
  CLOSE: 'Close',
};

// ─── Add money ────────────────────────────────────────────────────────────────

export const ADD_MONEY = {
  TITLE: 'Claim Testnet USDC',
  CLAIM_BUTTON: 'Claim',
  CLAIM_SUCCESS_TITLE: 'Testnet USDC Added',
  CLAIM_COOLDOWN_TITLE: 'Next Claim Available',
  CLAIM_ERROR_TITLE: 'Testnet USDC Claim Failed',
  COOLDOWN_HINT: (time: string) => `You can claim again in ${time}`,
};
