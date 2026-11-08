import type { ExpoConfig } from 'expo/config';

/**
 * Network lock-down.
 *
 * Release builds (preview / production) have INTERNET and ACCESS_NETWORK_STATE
 * REMOVED from the final merged manifest, so the app cannot open a socket at
 * all. This is what makes "images never leave the device" true in fact (and the
 * Play Data Safety answer honest).
 *
 * Development builds need INTERNET to reach the Metro bundler, so the lock-down
 * is skipped when EAS_BUILD_PROFILE === 'development' (set by eas.json) or when
 * ALLOW_DEV_NETWORK=1 is exported locally.
 */
const isDevBuild =
  process.env.EAS_BUILD_PROFILE === 'development' ||
  process.env.ALLOW_DEV_NETWORK === '1';

const config: ExpoConfig = {
  name: 'Contrast Inspector',
  slug: 'contrast-inspector',
  version: '1.0.0',
  scheme: 'contrastinspector',
  orientation: 'default', // rotation allowed (WCAG 1.3.4)
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic', // follow the system dark mode
  platforms: ['android'],
  android: {
    // CONFIRM BEFORE FIRST UPLOAD: a Google Play package name can never change.
    package: 'ro.dbg.contrastinspector',
    versionCode: 1,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    allowBackup: false, // screenshots may be sensitive; keep them out of cloud backups
    blockedPermissions: [
      // Not needed: images arrive via the system picker / share sheet (URI grants).
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      // `expo prebuild` puts VIBRATE in the base manifest by default. This app
      // has no haptics and no notifications, so drop it: it was the only
      // permission left in the built APK besides the AndroidX private one.
      'android.permission.VIBRATE',
      ...(isDevBuild
        ? []
        : [
            'android.permission.INTERNET',
            'android.permission.ACCESS_NETWORK_STATE',
            'android.permission.SYSTEM_ALERT_WINDOW',
          ]),
    ],
  },
  plugins: [
    [
      'expo-build-properties',
      {
        android: {
          // Android 16 = API 36. Required by Google Play for new apps from 31 Aug 2026.
          targetSdkVersion: 36,
        },
      },
    ],
    [
      'expo-share-intent',
      {
        // Android share target: appears in the share sheet for any image.
        androidIntentFilters: ['image/*'],
        disableIOS: true,
      },
    ],
    [
      'expo-image-picker',
      {
        // Gallery only; no camera by design (see README).
        photosPermission: false,
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
};

export default config;
