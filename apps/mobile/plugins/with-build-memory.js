// Gives the Android build more memory than the project template does. With the template's limits the build of
// this app ran out of class space after a few builds on a developer's machine, and stopped without an error
// halfway through a build on GitHub Actions.
const { withGradleProperties } = require("expo/config-plugins");

const KEY = "org.gradle.jvmargs";
const VALUE = "-Xmx4g -XX:MaxMetaspaceSize=1g";

/** The entries of android/gradle.properties with the build's memory limits set. */
function raiseBuildMemory(properties) {
  const others = properties.filter((entry) => !(entry.type === "property" && entry.key === KEY));
  return [...others, { type: "property", key: KEY, value: VALUE }];
}

module.exports = function withBuildMemory(config) {
  return withGradleProperties(config, (gradle) => {
    gradle.modResults = raiseBuildMemory(gradle.modResults);
    return gradle;
  });
};
module.exports.raiseBuildMemory = raiseBuildMemory;
