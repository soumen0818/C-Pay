import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { Logger } from './logger';

/**
 * Screen-capture protection for screens that show secrets (#162).
 *
 * Backed by the expo-screen-capture native module (`ExpoScreenCapture`).
 * It is resolved optionally, so the app still builds and runs when the module
 * is not linked. Callers get `available: false` and must show a warning. To
 * enable protection, add the module with `npx expo install expo-screen-capture`
 * and rebuild the dev client.
 *
 *   Android: the window is marked FLAG_SECURE, so screenshots and recordings
 *            come out blank.
 *   iOS:     screen recording/mirroring is blocked. Screenshots cannot be
 *            prevented by the OS, so a listener warns the user after one is taken.
 */

type Subscription = { remove: () => void };

type ScreenCaptureNativeModule = {
  preventScreenCapture?: (key?: string) => Promise<void>;
  allowScreenCapture?: (key?: string) => Promise<void>;
  addListener?: (eventName: string, listener: () => void) => Subscription;
};

let cachedModule: ScreenCaptureNativeModule | null | undefined;

function getNativeModule(): ScreenCaptureNativeModule | null {
  if (cachedModule !== undefined) return cachedModule;
  try {
    cachedModule = requireOptionalNativeModule<ScreenCaptureNativeModule>('ExpoScreenCapture') ?? null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

const activeKeys = new Set<string>();

export function isScreenCaptureProtectionAvailable(): boolean {
  const mod = getNativeModule();
  return !!mod && typeof mod.preventScreenCapture === 'function';
}

/** Whether the OS can block screenshots outright (Android) or only warn (iOS). */
export function canBlockScreenshots(): boolean {
  return Platform.OS === 'android' && isScreenCaptureProtectionAvailable();
}

export async function preventScreenCapture(key: string): Promise<boolean> {
  const mod = getNativeModule();
  if (!mod?.preventScreenCapture) return false;
  try {
    if (activeKeys.size === 0) {
      await mod.preventScreenCapture();
    }
    activeKeys.add(key);
    return true;
  } catch (error) {
    Logger.warn('Failed to enable screen-capture protection');
    return false;
  }
}

export async function allowScreenCapture(key: string): Promise<void> {
  const mod = getNativeModule();
  if (!activeKeys.delete(key)) return;
  if (activeKeys.size > 0 || !mod?.allowScreenCapture) return;
  try {
    await mod.allowScreenCapture();
  } catch (error) {
    Logger.warn('Failed to release screen-capture protection');
  }
}

export function addScreenshotListener(listener: () => void): Subscription | null {
  const mod = getNativeModule();
  if (!mod?.addListener) return null;
  try {
    return mod.addListener('onScreenshot', listener);
  } catch {
    return null;
  }
}

/**
 * While `active` is true, block screen capture and call `onScreenshot` if one
 * is taken anyway (iOS). Returns whether protection is in force.
 */
export function useScreenCaptureProtection(
  key: string,
  active: boolean,
  onScreenshot?: () => void
): { protected: boolean; available: boolean } {
  const [isProtected, setIsProtected] = useState(false);
  const onScreenshotRef = useRef(onScreenshot);
  onScreenshotRef.current = onScreenshot;

  useEffect(() => {
    if (!active) {
      setIsProtected(false);
      return undefined;
    }

    let cancelled = false;
    void preventScreenCapture(key).then((ok) => {
      if (!cancelled) setIsProtected(ok);
    });
    const subscription = addScreenshotListener(() => onScreenshotRef.current?.());

    return () => {
      cancelled = true;
      subscription?.remove();
      void allowScreenCapture(key);
    };
  }, [key, active]);

  return { protected: isProtected, available: isScreenCaptureProtectionAvailable() };
}

/** Test-only reset of module resolution and reference counts. */
export function __resetScreenCaptureForTests() {
  cachedModule = undefined;
  activeKeys.clear();
}
