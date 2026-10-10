// Keeps the app from sending usage records to Google. The QR scanner is Google's ML Kit, which brings a
// transport library that uploads usage statistics of the scanner. The app is for a server its user runs
// themselves and talks to nothing else, so the part of that library that does the uploading is taken out of the
// build: with no backend to send to, the library drops what it collected. Scanning itself is not affected.
const { withAndroidManifest } = require("expo/config-plugins");

const DISCOVERY = "com.google.android.datatransport.runtime.backends.TransportBackendDiscovery";
const BACKEND = "backend:com.google.android.datatransport.cct.CctBackendFactory";

/** The app's manifest with an instruction for the manifest merger: remove the upload backend that a library declares. */
function dropTelemetryBackend(manifest) {
  manifest.manifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
  const application = manifest.manifest.application[0];
  const services = (application.service ??= []);
  if (services.some((service) => service.$["android:name"] === DISCOVERY)) return manifest;
  services.push({
    $: { "android:name": DISCOVERY, "android:exported": "false", "tools:node": "merge" },
    "meta-data": [{ $: { "android:name": BACKEND, "tools:node": "remove" } }],
  });
  return manifest;
}

module.exports = function withNoTelemetry(config) {
  return withAndroidManifest(config, (android) => {
    android.modResults = dropTelemetryBackend(android.modResults);
    return android;
  });
};
module.exports.dropTelemetryBackend = dropTelemetryBackend;
