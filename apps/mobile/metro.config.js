// The default configuration already watches the workspace, so the shared packages resolve without extra paths.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
