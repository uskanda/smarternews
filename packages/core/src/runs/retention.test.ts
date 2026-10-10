import { describe, expect, it } from "vitest";
import { getArticle, setArticleFlags } from "../db/articles.ts";
import { getRun } from "../db/runs.ts";
import { pipelineHarness } from "../testing/pipeline.ts";
import { purgeExpired } from "./retention.ts";

const FEED = "https://example.org/feed.xml";
const DAY = 86_400_000;

async function seeded() {
  const h = pipelineHarness();
  h.addTopic("Topic", { feeds: [FEED] });
  h.feed(FEED, [
    { title: "Kept story", link: "https://example.org/kept" },
    { title: "Plain story", link: "https://example.org/plain" },
    { title: "Ad [skip]", link: "https://example.org/ad" },
  ]);
  const run = await h.run();
  const [kept, plain] = h.articles();
  setArticleFlags(h.db, kept!.id, { starred: true });
  return { h, run, kept: kept!, plain: plain! };
}

describe("purgeExpired", () => {
  it("keeps everything that is younger than its retention period", async () => {
    const { h, run, plain } = await seeded();
    h.clock.advance(29 * DAY);

    purgeExpired(h.db, h.clock);

    expect(getRun(h.db, run.id).id).toBe(run.id);
    expect(h.candidates(run.id, "rejected")).toHaveLength(1);
    expect(getArticle(h.db, plain.id).title).toBe("Plain story");
  });

  it("removes a run and its rejected candidates after thirty days", async () => {
    const { h, run } = await seeded();
    h.clock.advance(31 * DAY);

    purgeExpired(h.db, h.clock);

    expect(() => getRun(h.db, run.id)).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(h.candidates(run.id)).toEqual([]);
  });

  it("removes an article without a star 180 days after its last update", async () => {
    const { h, plain } = await seeded();
    h.clock.advance(181 * DAY);

    purgeExpired(h.db, h.clock);

    expect(() => getArticle(h.db, plain.id)).toThrow(expect.objectContaining({ code: "not_found" }));
  });

  it("keeps a starred article however old it is", async () => {
    const { h, kept } = await seeded();
    h.clock.advance(365 * DAY);

    purgeExpired(h.db, h.clock);

    expect(getArticle(h.db, kept.id).title).toBe("Kept story");
  });

  it("still treats a purged candidate's URL as settled", async () => {
    const { h } = await seeded();
    h.clock.advance(40 * DAY);
    purgeExpired(h.db, h.clock);
    h.feed(FEED, [{ title: "Ad [skip]", link: "https://example.org/ad" }]);

    const run = await h.run();

    expect(run).toMatchObject({ collected: 0, llmCalls: 0 });
  });
});
