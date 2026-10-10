// Starts the server's test process once for the whole run and hands its address to the tests.
const { spawn } = require("node:child_process");
const { join } = require("node:path");

module.exports = async function globalSetup() {
  const script = join(__dirname, "../../../server/src/testing-process.ts");
  const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once("data", (chunk) => resolve(/LISTENING (\d+)/.exec(String(chunk))?.[1]));
    child.once("exit", (code) => reject(new Error(`the test server process ended with code ${code} before it listened`)));
  });
  if (!port) throw new Error("the test server process did not report a port");
  process.env.SMARTERNEWS_TEST_API = `http://127.0.0.1:${port}`;
  globalThis.__SMARTERNEWS_TEST_PROCESS__ = child;
};
