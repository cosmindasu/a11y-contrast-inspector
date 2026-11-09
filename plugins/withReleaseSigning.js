/**
 * Release signing that survives `expo prebuild`.
 *
 * `android/` is generated and git-ignored, so a signing config written into
 * `android/app/build.gradle` by hand is erased by the next prebuild — which is
 * exactly how a release ends up signed with the debug key without anyone
 * noticing. This plugin re-applies it every time the native project is
 * generated.
 *
 * The keystore itself never enters the repository. It is read from the
 * environment at build time:
 *
 *   ANDROID_KEYSTORE_PATH      absolute path to the .jks
 *   ANDROID_KEYSTORE_PASSWORD  store password
 *   ANDROID_KEY_ALIAS          key alias
 *   ANDROID_KEY_PASSWORD       key password
 *
 * With those unset the build still works and still uses the debug key, so
 * local release testing is unaffected — but it says so loudly at configure
 * time rather than producing a debug-signed APK in silence.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_SIGNING_CONFIG = `
        release {
            def storePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (storePath) {
                storeFile file(storePath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }`;

const RELEASE_SIGNING_CHOICE = `            if (System.getenv("ANDROID_KEYSTORE_PATH")) {
                signingConfig signingConfigs.release
            } else if (System.getenv("EAS_BUILD_PROFILE") in ["preview", "production"]) {
                // A build on one of these profiles exists to be handed to
                // someone. Falling back to the debug key here would produce an
                // artefact that installs, looks finished, and is signed with a
                // key whose password is the public string 'android'. A warning
                // is not enough for that: EAS prints thousands of lines and
                // nobody reads the middle of them.
                throw new GradleException(
                    "Refusing to build profile '" + System.getenv("EAS_BUILD_PROFILE") +
                    "' with the debug key. Set ANDROID_KEYSTORE_PATH, " +
                    "ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD, " +
                    "or build a profile that is not meant for distribution.")
            } else {
                // A local release build with no keystore is the normal way to
                // test one, so this stays a warning.
                logger.warn("")
                logger.warn("*** This release build is signed with the DEBUG key. ***")
                logger.warn("    Its password is public ('android'), so the APK is fine for")
                logger.warn("    testing and must never be distributed. Set")
                logger.warn("    ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD,")
                logger.warn("    ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD to sign properly.")
                logger.warn("")
                signingConfig signingConfigs.debug
            }`;

/** Anchor on the generated template; fail loudly if it ever changes shape. */
const DEBUG_CONFIG_END = `            keyPassword 'android'
        }
    }`;

const RELEASE_BUILD_TYPE = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

function applySigning(contents) {
  if (contents.includes('ANDROID_KEYSTORE_PATH')) return contents; // already applied

  if (!contents.includes(DEBUG_CONFIG_END)) {
    throw new Error(
      '[withReleaseSigning] Could not find the debug signingConfig block in ' +
        'android/app/build.gradle. The Expo template changed; update this plugin ' +
        'rather than letting the release fall back to the debug key silently.',
    );
  }
  if (!contents.includes(RELEASE_BUILD_TYPE)) {
    throw new Error(
      '[withReleaseSigning] Could not find the release buildType signingConfig in ' +
        'android/app/build.gradle. The Expo template changed; update this plugin.',
    );
  }

  return contents
    .replace(
      DEBUG_CONFIG_END,
      `            keyPassword 'android'
        }${RELEASE_SIGNING_CONFIG}
    }`,
    )
    .replace(RELEASE_BUILD_TYPE, RELEASE_SIGNING_CHOICE);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('[withReleaseSigning] expected a Groovy build.gradle.');
    }
    cfg.modResults.contents = applySigning(cfg.modResults.contents);
    return cfg;
  });
};

// Exported for the unit test: the string rewrite is the part worth checking.
module.exports.applySigning = applySigning;
