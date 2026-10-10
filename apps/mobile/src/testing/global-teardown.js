module.exports = async function globalTeardown() {
  globalThis.__SMARTERNEWS_TEST_PROCESS__?.kill();
};
