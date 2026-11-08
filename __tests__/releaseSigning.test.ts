/* eslint-disable @typescript-eslint/no-var-requires */
const { applySigning } = require('../plugins/withReleaseSigning');

/** The shape `expo prebuild` generates today, trimmed to what the plugin touches. */
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('withReleaseSigning', () => {
  const out: string = applySigning(TEMPLATE);

  it('adds a release signingConfig fed from the environment', () => {
    expect(out).toContain('ANDROID_KEYSTORE_PATH');
    expect(out).toContain('ANDROID_KEYSTORE_PASSWORD');
    expect(out).toContain('ANDROID_KEY_ALIAS');
    expect(out).toContain('ANDROID_KEY_PASSWORD');
    expect(out).toMatch(/signingConfigs\s*\{[\s\S]*release\s*\{/);
  });

  it('points the release build type at it, and warns when falling back', () => {
    expect(out).toContain('signingConfig signingConfigs.release');
    expect(out).toContain('DEBUG key');
    // The debug build type must be left exactly as it was.
    expect(out).toMatch(/debug \{\n            signingConfig signingConfigs\.debug\n        \}/);
  });

  it('never hardcodes a credential: every release value comes from the env', () => {
    // The inner `}` of the if is indented 12 spaces, the block's own close 8,
    // so this stops in the right place.
    const block = /\n        release \{\n([\s\S]*?)\n        \}/.exec(out)?.[1];
    expect(block).toBeDefined();
    expect(block).not.toMatch(/'[^']*'/); // no quoted literal at all
    expect(block!.match(/System\.getenv/g)?.length).toBe(4);
  });

  it('is idempotent: a second prebuild must not double-apply', () => {
    expect(applySigning(out)).toBe(out);
  });

  it('refuses silently-wrong input instead of leaving a debug-signed release', () => {
    // If Expo ever changes the template, failing the build is the only safe
    // outcome: the alternative is shipping an APK signed with a public key.
    expect(() => applySigning('android { buildTypes { release { } } }')).toThrow(
      /signingConfig block/,
    );
    const noBuildType = TEMPLATE.replace(
      '            // Caution! In production, you need to generate your own keystore file.\n' +
        '            // see https://reactnative.dev/docs/signed-apk-android.\n' +
        '            signingConfig signingConfigs.debug\n',
      '',
    );
    expect(() => applySigning(noBuildType)).toThrow(/release buildType/);
  });
});
