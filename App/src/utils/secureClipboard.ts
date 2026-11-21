import * as Clipboard from 'expo-clipboard';
import { AppState, AppStateStatus } from 'react-native';
import { Logger } from './logger';

/**
 * Clipboard handling for secrets such as the Stellar secret seed (#162).
 *
 * A copied secret is wiped from the system clipboard automatically:
 *   - after SENSITIVE_CLIPBOARD_CLEAR_SECONDS, and
 *   - as soon as C-Pay goes to the background (JS timers may not run while
 *     backgrounded, so the secret could otherwise linger indefinitely).
 */

export const SENSITIVE_CLIPBOARD_CLEAR_SECONDS = 45;

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let holdsSecret = false;

function stopWatching() {
  if (clearTimer) {
    clearTimeout(clearTimer);
    clearTimer = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
}

/**
 * Wipe a secret previously placed by copySensitiveToClipboard. A no-op if no
 * secret is pending, so it never clobbers unrelated clipboard contents.
 */
export async function clearSensitiveClipboard(): Promise<void> {
  stopWatching();
  if (!holdsSecret) return;
  holdsSecret = false;
  try {
    await Clipboard.setStringAsync('');
  } catch (error) {
    Logger.warn('Failed to clear sensitive clipboard contents');
  }
}

/**
 * Copy a secret to the clipboard and schedule its removal.
 */
export async function copySensitiveToClipboard(
  value: string,
  clearAfterSeconds: number = SENSITIVE_CLIPBOARD_CLEAR_SECONDS
): Promise<void> {
  stopWatching();
  await Clipboard.setStringAsync(value);
  holdsSecret = true;

  clearTimer = setTimeout(() => {
    void clearSensitiveClipboard();
  }, clearAfterSeconds * 1000);

  appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'background') {
      void clearSensitiveClipboard();
    }
  });
}

/** Test-only: whether a secret is currently scheduled for removal. */
export function __isHoldingSensitiveClipboard(): boolean {
  return holdsSecret;
}
