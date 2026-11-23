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
  SEND_CREDITS: 'Send USDC',
  CLAIM_CREDITS: 'Claim testnet USDC',
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
  GET_STARTED: 'Get Started',
  ALREADY_HAVE_ACCOUNT: 'Already have an account? Sign in',
  FEATURE_SECURE: 'Secure',
  FEATURE_SECURE_DESC: 'Your wallet is encrypted on device',
  FEATURE_FAST: 'Fast',
  FEATURE_FAST_DESC: 'Payments settle in seconds on Stellar',
  FEATURE_SIMPLE: 'Simple',
  FEATURE_SIMPLE_DESC: 'QR codes and C-Pay IDs — no addresses',
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
};

// ─── Payments ─────────────────────────────────────────────────────────────────

export const PAYMENT = {
  SEND_TITLE: 'Send USDC',
  RECIPIENT_LABEL: 'To (C-Pay ID or wallet address)',
  RECIPIENT_PLACEHOLDER: 'user@cpay… or G…',
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
  CLAIM_ERROR_TITLE: 'Credit Claim Failed',
  COOLDOWN_HINT: (time: string) => `You can claim again in ${time}`,
};

// ─── Info & Legal Documents ───────────────────────────────────────────────────

export type InfoDoc = 'privacy' | 'terms' | 'about' | 'support';

export interface InfoBlock {
  type: 'heading' | 'paragraph';
  text: string;
}

export interface InfoDocument {
  title: string;
  blocks: InfoBlock[];
}

export const INFO_SUPPORT_EMAIL = 'support@cpay.app';

export const INFO_DOCS: Record<InfoDoc, InfoDocument> = {
  about: {
    title: 'About C-Pay',
    blocks: [
      { type: 'paragraph', text: 'C-Pay v1.0.3' },
      { type: 'paragraph', text: 'C-Pay is a closed-pilot payment app built on the Stellar testnet. It provides fast, simple UPI-style test payments using testnet USDC.' },
      { type: 'paragraph', text: 'Testnet USDC is for testing only. It is not real money, holds no cash value, and cannot be redeemed for fiat or legal tender.' },
      { type: 'paragraph', text: '© 2026 C-Pay. All rights reserved.' },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    blocks: [
      { type: 'heading', text: 'Overview' },
      { type: 'paragraph', text: 'C-Pay is built with local-first security and privacy by design. Your private keys and PIN are encrypted directly on your device and are never sent to our servers in plaintext. This policy details all data stored, third-party processors, retention periods, and your rights to delete your data.' },

      { type: 'heading', text: 'Stored Fields & Data' },
      { type: 'paragraph', text: 'When you create an account and transact on C-Pay, the following data is collected and stored:\n• Account & Identity: Your verified email address, user-chosen display name, unique C-Pay ID, and Stellar wallet public key (wallet_address).\n• Profile Photos (Public Storage URLs): If you choose to upload a profile photo, the image file is uploaded to a public storage bucket (profile-images) under your account folder (<auth.uid>/avatar.jpg). Public URLs are generated so your avatar can be rendered seamlessly across peer transfers, recipient confirmation, and contact discovery without signature expiration. Row-level security strictly ensures only you can upload, overwrite, or delete your own profile photo.\n• Payment & Transfer Records: Transaction records stored in our database include transaction hashes, sender and recipient Stellar wallet addresses, display names, transfer amounts, payment status, sequence numbers, timestamps, and any optional payment notes/memos entered by the sender.\n• Encrypted Cloud Backups: If you set up cloud backup, an encrypted ciphertext of your wallet secret key, alongside cryptographic salt, algorithm metadata, and KDF parameters, is stored in our database. Cloud backups are encrypted client-side with a recovery password only you know; C-Pay servers cannot decrypt your secret key.\n• Local Device Data: Your encrypted wallet secret, PIN verifier hash, attempt lockout counters, biometric credentials, and local transaction caches are stored securely on your device using SecureStore and AsyncStorage.' },

      { type: 'heading', text: 'Third-Party Data Processors' },
      { type: 'paragraph', text: 'C-Pay uses the following third-party infrastructure providers to operate the application:\n• Supabase Inc.: Provides hosted PostgreSQL database services, user authentication (email OTP verification), and object storage for profile avatars.\n• Relayer Hosting Infrastructure (Render / Cloud Host): Hosts the relayer API proxy that provides transaction fee sponsorship and relaying. The relayer processes incoming request metadata, client IP addresses, user agents, and diagnostic server logs to enforce rate limits, prevent DDoS abuse, and monitor system health.\n• Stellar Development Foundation (SDF) & Horizon Nodes: Operates the public Stellar testnet validator nodes that process and commit transactions to the public ledger.' },

      { type: 'heading', text: 'Public Blockchain Ledger' },
      { type: 'paragraph', text: 'Payments are recorded on the public Stellar testnet blockchain. Transaction amounts, sender and recipient wallet public addresses, transaction hashes, and ledger timestamps are publicly and permanently visible on-chain to any block explorer.' },

      { type: 'heading', text: 'Data Retention Periods' },
      { type: 'paragraph', text: '• Account and Profile Data: Your email, display name, C-Pay ID, profile photo, and encrypted backups are retained only for the active lifetime of your account. They are immediately purged when you delete your account.\n• Relayer Server Logs: Client IP addresses and diagnostic HTTP request logs are retained for up to 30 days by the hosting infrastructure for abuse prevention, rate-limiting, and error diagnosis, after which they are automatically rotated and discarded.\n• Public Blockchain Records: On-chain transactions committed to the Stellar testnet ledger are immutable on the blockchain ledger (subject only to periodic testnet ledger resets by SDF).' },

      { type: 'heading', text: 'Data Deletion (Your Rights)' },
      { type: 'paragraph', text: 'You have the right to permanently delete your account and all associated data at any time directly in the app:\n1. Open Profile.\n2. Tap Security (or Security Center).\n3. Tap "Delete my account".\n\nWhen you delete your account:\n• The delete_my_account database routine permanently deletes your account and cascades removal of your profile, verified email, C-Pay ID, payment records, and encrypted cloud backups from our servers.\n• Your uploaded avatar is deleted from the public storage bucket.\n• All local wallet secrets, PIN verifiers, biometric credentials, and cached data are completely wiped from your device.' },

      { type: 'heading', text: 'Contact & Monitored Support' },
      { type: 'paragraph', text: 'For privacy inquiries, account questions, or data deletion support, email support@cpay.app. The support@cpay.app domain is designated for C-Pay pilot communications and actively monitored by the C-Pay team.' },
    ],
  },
  terms: {
    title: 'Terms of Service',
    blocks: [
      { type: 'heading', text: 'Closed Pilot Program' },
      { type: 'paragraph', text: 'C-Pay is provided as an experimental closed-pilot payment application on the Stellar testnet. All balances are in testnet USDC. Test assets have no monetary value, cannot be redeemed for cash or legal tender, and are provided solely for pilot testing.' },

      { type: 'heading', text: 'Fee Sponsorship' },
      { type: 'paragraph', text: 'Stellar network transaction fees are sponsored by C-Pay as a pilot courtesy to provide a seamless UPI-like experience. C-Pay reserves the right to enforce rate limits, velocity checks, and daily quotas, or suspend sponsorship during high network congestion or maintenance.' },

      { type: 'heading', text: 'Non-Reversible Payments' },
      { type: 'paragraph', text: 'All payments settle on the Stellar blockchain and are final. C-Pay cannot reverse, cancel, charge back, or refund payments once submitted to the network. You are responsible for verifying recipient C-Pay IDs and amounts before confirming.' },

      { type: 'heading', text: 'Pilot Resets and Discontinuation' },
      { type: 'paragraph', text: 'Because C-Pay operates on the Stellar testnet, network states, ledger history, and wallet balances may be reset, altered, or wiped at any time during testnet network resets or pilot upgrades. C-Pay is provided “as is” without warranties of any kind.' },

      { type: 'heading', text: 'User Responsibilities' },
      { type: 'paragraph', text: 'You are responsible for safeguarding your 6-digit PIN, cloud recovery password, and any exported secret keys. Anyone with access to your device PIN or recovery keys can authorize transfers. C-Pay cannot recover lost PINs or lost passwords.' },

      { type: 'heading', text: 'Contact' },
      { type: 'paragraph', text: 'Questions about these terms? Contact us at support@cpay.app.' },
    ],
  },
  support: {
    title: 'Help & Support',
    blocks: [
      { type: 'heading', text: 'Getting Started' },
      { type: 'paragraph', text: 'Send testnet USDC from the Home or Send screen by entering a C-Pay ID or scanning a QR code. Confirm every payment with your PIN or biometrics before it is signed.' },

      { type: 'heading', text: 'Wallet Recovery' },
      { type: 'paragraph', text: 'Set up cloud backup in the Security Center with a strong recovery password to restore your wallet on a new device. You can also export your secret key from Security Center.' },

      { type: 'heading', text: 'Common Issues' },
      { type: 'paragraph', text: 'If a payment fails, your balance is not deducted. Check your internet connection and try again.' },
    ],
  },
};
