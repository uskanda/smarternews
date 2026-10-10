// Signs the release build with a keystore named in the environment. The keystore and its passwords never enter
// the repository: the release workflow puts them into the environment from GitHub secrets, and a developer
// does the same from files kept elsewhere. Without them the release build is signed with the debug key, which
// is enough to try a build on an emulator and cannot update an app that was installed from a release.
//
//   SMARTERNEWS_KEYSTORE_FILE       path of the keystore
//   SMARTERNEWS_KEYSTORE_PASSWORD   its password
//   SMARTERNEWS_KEY_ALIAS           the key's name inside it
//   SMARTERNEWS_KEY_PASSWORD        the key's password
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_CONFIG = `        release {
            if (System.getenv('SMARTERNEWS_KEYSTORE_FILE')) {
                storeFile file(System.getenv('SMARTERNEWS_KEYSTORE_FILE'))
                storePassword System.getenv('SMARTERNEWS_KEYSTORE_PASSWORD')
                keyAlias System.getenv('SMARTERNEWS_KEY_ALIAS')
                keyPassword System.getenv('SMARTERNEWS_KEY_PASSWORD')
            }
        }
`;
const CHOICE = "signingConfig System.getenv('SMARTERNEWS_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug";

/** The contents of android/app/build.gradle with the release build signed as described above. */
function signRelease(gradle) {
  if (gradle.includes(CHOICE)) return gradle;
  const configs = /(\n {4}signingConfigs \{\n(?:.*\n)*? {8}debug \{\n(?:.*\n)*? {8}\}\n)/;
  const release = /(\n {8}release \{\n(?:\s*\/\/.*\n)*)\s*signingConfig signingConfigs\.debug\n/;
  if (!configs.test(gradle) || !release.test(gradle)) {
    throw new Error("with-release-signing: android/app/build.gradle no longer has the signing section this plugin edits");
  }
  return gradle.replace(configs, `$1${RELEASE_CONFIG}`).replace(release, `$1            ${CHOICE}\n`);
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradle) => {
    gradle.modResults.contents = signRelease(gradle.modResults.contents);
    return gradle;
  });
};
module.exports.signRelease = signRelease;
