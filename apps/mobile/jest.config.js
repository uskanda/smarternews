// Screens are tested against the real API: `src/testing/global-setup.js` starts the server's test process, and
// each test asks it for a server of its own (see `src/testing/server.ts`).
// Dates are shown in the time zone of the server's settings. Running in UTC keeps a test from passing only
// because the machine happens to be in that zone.
process.env.TZ = "UTC";

module.exports = {
  preset: "jest-expo",
  // Each test talks to a real server over a socket and types and presses at a person's pace.
  testTimeout: 20000,
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}", "<rootDir>/plugins/**/*.test.ts", "<rootDir>/*.test.ts"],
  globalSetup: "<rootDir>/src/testing/global-setup.js",
  globalTeardown: "<rootDir>/src/testing/global-teardown.js",
  setupFilesAfterEnv: ["<rootDir>/src/testing/setup.tsx"],
  // jest-expo's own list of packages that go through Babel, plus `marked`, which ships ES modules only.
  transformIgnorePatterns: [
    ...require("jest-expo/jest-preset").transformIgnorePatterns.map((pattern, index) => (index === 0 ? pattern.replace("(?!(", "(?!(marked|") : pattern)),
  ],
};
