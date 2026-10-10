const { signRelease } = require("./with-release-signing") as { signRelease: (gradle: string) => string };

// The part of the generated app/build.gradle that the plugin works on.
const GENERATED = `android {
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

describe("signRelease", () => {
  const signed = signRelease(GENERATED);

  it("adds a release signing configuration that reads the keystore and its passwords from the environment", () => {
    expect(signed).toContain("release {\n            if (System.getenv('SMARTERNEWS_KEYSTORE_FILE')) {");
    for (const name of ["SMARTERNEWS_KEYSTORE_FILE", "SMARTERNEWS_KEYSTORE_PASSWORD", "SMARTERNEWS_KEY_ALIAS", "SMARTERNEWS_KEY_PASSWORD"]) {
      expect(signed).toContain(`System.getenv('${name}')`);
    }
  });

  it("signs the release build with that configuration when a keystore is given, and with the debug key otherwise", () => {
    expect(signed).toContain("signingConfig System.getenv('SMARTERNEWS_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug");
    const release = signed.slice(signed.indexOf("buildTypes {"));
    expect(release.match(/signingConfig signingConfigs\.debug/g)).toHaveLength(1); // the debug build type only
  });

  it("holds no password and no path of its own", () => {
    expect(signed.replace(GENERATED, "")).not.toMatch(/storePassword '[^']+'[^\n]*\n[^\n]*release/);
    expect(signed).not.toMatch(/\.jks|\.keystore'\)\s*\/\/ release/);
  });

  it("changes nothing the second time it runs", () => {
    expect(signRelease(signed)).toBe(signed);
  });

  it("fails loudly when the generated file no longer has the place it edits", () => {
    expect(() => signRelease("android {\n}\n")).toThrow(/build\.gradle/);
  });
});
