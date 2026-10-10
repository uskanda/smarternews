// What the Android build is made from. Nothing here names a server or a user: the server's URL and the token
// are typed or scanned in the running app.
import type { ExpoConfig } from "expo/config";

/** The release tag, such as v26.10.1, without the "v". A local build has no tag. */
const version = (process.env.SMARTERNEWS_APP_VERSION ?? "0.0.0").replace(/^v/, "");
/** Grows with every build made for a release, so that Android accepts a newer APK over an older one. */
const versionCode = Number(process.env.SMARTERNEWS_APP_VERSION_CODE ?? 1);

/** The processor kinds to build for, such as "arm64-v8a,x86_64". Unset builds for all four, which is large. */
const archs = process.env.SMARTERNEWS_ANDROID_ARCHS?.split(",")
  .map((name: string) => name.trim())
  .filter(Boolean);

/** The font files that are built into the app: one per weight a typography role of DESIGN.md uses. */
const font = (family: string, file: string) => require.resolve(`@expo-google-fonts/${family}/${file.split("_")[1]}/${file}.ttf`);
const fonts = [
  font("shippori-mincho", "ShipporiMincho_500Medium"),
  font("shippori-mincho", "ShipporiMincho_700Bold"),
  font("ibm-plex-sans-jp", "IBMPlexSansJP_400Regular"),
  font("ibm-plex-sans-jp", "IBMPlexSansJP_600SemiBold"),
];

const config: ExpoConfig = {
  name: "smarternews",
  slug: "smarternews",
  scheme: "smarternews",
  version,
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  android: {
    package: "io.github.uskanda.smarternews",
    versionCode,
    adaptiveIcon: {
      foregroundImage: "./assets/icon-foreground.png",
      monochromeImage: "./assets/icon-monochrome.png",
      backgroundColor: "#24418F",
    },
    // Asked for by libraries, for things this app does not do: drawing over other apps, biometrics, shared
    // storage, the microphone, push messages from Google, install tracking, and badges on launcher icons.
    blockedPermissions: [
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.USE_BIOMETRIC",
      "android.permission.USE_FINGERPRINT",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_APP_BADGE",
      "com.google.android.c2dm.permission.RECEIVE",
      "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
      "com.anddoes.launcher.permission.UPDATE_COUNT",
      "com.android.launcher.permission.INSTALL_SHORTCUT",
      "com.android.launcher.permission.UNINSTALL_SHORTCUT",
      "com.android.launcher.permission.READ_SETTINGS",
      "com.android.launcher.permission.WRITE_SETTINGS",
      "com.htc.launcher.permission.READ_SETTINGS",
      "com.htc.launcher.permission.UPDATE_SHORTCUT",
      "com.huawei.android.launcher.permission.CHANGE_BADGE",
      "com.huawei.android.launcher.permission.READ_SETTINGS",
      "com.huawei.android.launcher.permission.WRITE_SETTINGS",
      "com.majeur.launcher.permission.UPDATE_BADGE",
      "com.oppo.launcher.permission.READ_SETTINGS",
      "com.oppo.launcher.permission.WRITE_SETTINGS",
      "com.sec.android.provider.badge.permission.READ",
      "com.sec.android.provider.badge.permission.WRITE",
      "com.sonyericsson.home.permission.BROADCAST_BADGE",
      "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
      "me.everything.badger.permission.BADGE_COUNT_READ",
      "me.everything.badger.permission.BADGE_COUNT_WRITE",
    ],
  },
  plugins: [
    "expo-router",
    ["expo-font", { fonts }],
    ["expo-splash-screen", { image: "./assets/icon-foreground.png", imageWidth: 160, backgroundColor: "#24418F" }],
    // The server is reached over plain HTTP on a private network, and its address is the user's to choose.
    ["expo-build-properties", { android: { usesCleartextTraffic: true, ...(archs ? { buildArchs: archs } : {}) } }],
    "expo-secure-store",
    ["expo-camera", { cameraPermission: "接続用のQRコードを読み取るために、カメラを使います。", recordAudioAndroid: false }],
    "expo-notifications",
    "expo-background-task",
    "expo-web-browser",
    "./plugins/with-release-signing",
    "./plugins/with-no-telemetry",
    "./plugins/with-build-memory",
  ],
  experiments: { typedRoutes: true },
};

export default config;
