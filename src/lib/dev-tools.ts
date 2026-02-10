import Constants from 'expo-constants';

/**
 * Developer tools configuration.
 * Controlled by EXPO_PUBLIC_DEV_TOOLS env variable.
 * Set to "true" in .env to enable dev tools throughout the app.
 */
export const DEV_TOOLS_ENABLED =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_DEV_TOOLS === 'true' ||
  process.env.EXPO_PUBLIC_DEV_TOOLS === 'true';

/**
 * Check if we're running in development mode (Expo dev client / metro bundler).
 */
export const IS_DEV = __DEV__;
