import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExpoConfig } from "expo/config";

function load(env: Record<string, string> = {}): ExpoConfig {
  let config: ExpoConfig | undefined;
  const before = { ...process.env };
  Object.assign(process.env, env);
  jest.isolateModules(() => {
    config = (require("./app.config") as { default: ExpoConfig }).default;
  });
  process.env = before;
  return config!;
}

const plugin = (config: ExpoConfig, name: string) => (config.plugins ?? []).find((entry) => (Array.isArray(entry) ? entry[0] : entry) === name);

describe("the app configuration", () => {
  it("keeps the screen in portrait and follows the device's colour scheme", () => {
    const config = load();
    expect(config.orientation).toBe("portrait");
    expect(config.userInterfaceStyle).toBe("automatic");
  });

  it("allows connections without encryption, which a server on a private network needs", () => {
    expect(plugin(load(), "expo-build-properties")).toEqual(["expo-build-properties", { android: { usesCleartextTraffic: true } }]);
  });

  it("builds for the processor kinds named in the environment", () => {
    const config = load({ SMARTERNEWS_ANDROID_ARCHS: "arm64-v8a, x86_64" });
    expect(plugin(config, "expo-build-properties")).toEqual(["expo-build-properties", { android: { usesCleartextTraffic: true, buildArchs: ["arm64-v8a", "x86_64"] } }]);
  });

  it("takes the upload of usage records out of the build", () => {
    expect(load().plugins).toContain("./plugins/with-no-telemetry");
  });

  it("signs the release build through the signing plugin", () => {
    expect(load().plugins).toContain("./plugins/with-release-signing");
  });

  it("carries the name, the identifier and the link scheme of the app", () => {
    const config = load();
    expect(config.name).toBe("smarternews");
    expect(config.android?.package).toBe("io.github.uskanda.smarternews");
    expect(config.scheme).toBe("smarternews");
  });

  it("takes the version name from the release tag and the version code from the build number", () => {
    const config = load({ SMARTERNEWS_APP_VERSION: "v26.10.2", SMARTERNEWS_APP_VERSION_CODE: "37" });
    expect(config.version).toBe("26.10.2");
    expect(config.android?.versionCode).toBe(37);
  });

  it("names no server and holds no token", () => {
    const text = JSON.stringify(load());
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/token/i);
  });

  it("builds in one font file for every font that the generated typography names", () => {
    const { typography } = require("./src/theme/tokens") as { typography: Record<string, { fontFamily: string }> };
    const entry = plugin(load(), "expo-font") as [string, { fonts: string[] }];
    const bundled = entry[1].fonts.map((path) => path.split("/").pop()!.replace(/\.ttf$/, "")).sort();
    const used = [...new Set(Object.values(typography).map((role) => role.fontFamily))].sort();
    expect(bundled).toEqual(used);
    for (const path of entry[1].fonts) expect(existsSync(path)).toBe(true);
  });

  it("has an icon that Android can cut to any shape and tint", () => {
    const config = load();
    expect(config.android?.adaptiveIcon).toMatchObject({ backgroundColor: "#24418F" });
    for (const file of [config.icon, config.android?.adaptiveIcon?.foregroundImage, config.android?.adaptiveIcon?.monochromeImage]) {
      expect(existsSync(join(__dirname, file!))).toBe(true);
    }
  });

  it("refuses the permissions that its libraries ask for and the app does not use", () => {
    const blocked = load().android?.blockedPermissions ?? [];
    for (const name of [
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.RECORD_AUDIO",
      "com.google.android.c2dm.permission.RECEIVE",
      "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
    ]) {
      expect(blocked).toContain(name);
    }
    // What the app does use must stay.
    for (const name of ["android.permission.INTERNET", "android.permission.CAMERA", "android.permission.POST_NOTIFICATIONS"]) {
      expect(blocked).not.toContain(name);
    }
  });

  it("asks for the camera with a reason and never for the microphone", () => {
    expect(plugin(load(), "expo-camera")).toEqual(["expo-camera", expect.objectContaining({ recordAudioAndroid: false, cameraPermission: expect.stringContaining("QRコード") })]);
  });
});
