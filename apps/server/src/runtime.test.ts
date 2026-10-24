import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRuntime } from "./runtime.ts";

describe("the runtime", () => {
  it("summarises feed articles and fetches their full content from its start until it is closed, with the limit of the configuration", async () => {
    const root = mkdtempSync(join(tmpdir(), "sn-runtime-"));
    const runtime = createRuntime({ env: { SMARTERNEWS_CONFIG_DIR: join(root, "config"), SMARTERNEWS_DATA_DIR: join(root, "data") }, home: root });
    expect(runtime.summarizer.running).toBe(false);
    expect(runtime.fullContent.running).toBe(false);

    runtime.start();
    expect(runtime.summarizer.running).toBe(true);
    expect(runtime.fullContent.running).toBe(true);
    // Nothing is subscribed, so the first look of each part ends without a request.
    await Promise.all([runtime.poller.idle(), runtime.summarizer.idle(), runtime.fullContent.idle()]);

    runtime.close();
    expect(runtime.summarizer.running).toBe(false);
    expect(runtime.fullContent.running).toBe(false);
  });
});
