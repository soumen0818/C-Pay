import Constants from 'expo-constants';

/**
 * Single source of truth for the app version read from Expo configuration (app.json).
 */
export const APP_VERSION: string =
  Constants.expoConfig?.version ||
  (Constants as any).manifest2?.extra?.expoClient?.version ||
  (Constants as any).manifest?.version ||
  '1.0.3';
