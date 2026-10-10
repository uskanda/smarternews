import { describe, expect, it } from "vitest";
import type { WriteOutput } from "../llm/tasks.ts";
import { defaultHandlers, pipelineHarness } from "../testing/pipeline.ts";

const FEED = "https://example.org/events.xml";

type EventFields = NonNullable<WriteOutput["event"]>;

function harness(events: Record<string, Partial<EventFields> | null>) {
  const h = pipelineHarness({ kind: "event", outputLanguage: "ja", now: "2026-03-01T12:00:00.000Z" });
  h.addTopic("Maker fairs", { feeds: [FEED] });
  h.handlers.write = (request) => {
    const base = defaultHandlers.write(request) as WriteOutput;
    const event = events[base.title];
    return {
      ...base,
      event:
        event === null || event === undefined
          ? null
          : { name: base.title, startsAt: null, endsAt: null, venue: null, fee: null, registration: "unknown", ...event },
    };
  };
  return h;
}

describe("event categories", () => {
  it("stores the start, end, venue, fee and registration of an event", async () => {
    const h = harness({
      "Spring Maker Fair": { startsAt: "2026-03-07T10:00", endsAt: "2026-03-08T16:00", venue: "City Hall", registration: "not_required" },
    });
    h.feed(FEED, [{ title: "Spring Maker Fair", link: "https://example.org/fair", published: "2026-01-10T00:00:00Z" }]);

    await h.run();

    expect(h.articles()).toMatchObject([
      {
        kind: "event",
        title: "Spring Maker Fair",
        event: {
          startsAt: "2026-03-07T10:00:00.000Z",
          endsAt: "2026-03-08T16:00:00.000Z",
          venue: "City Hall",
          fee: null,
          registration: "not_required",
        },
      },
    ]);
  });

  it("treats an event given only a date as lasting that whole day", async () => {
    const h = harness({ "Open Day": { startsAt: "2026-03-03" } });
    h.feed(FEED, [{ title: "Open Day", link: "https://example.org/open" }]);

    await h.run();

    expect(h.articles()[0]!.event).toMatchObject({ startsAt: "2026-03-03T00:00:00.000Z", endsAt: "2026-03-03T23:59:59.999Z" });
  });

  it("does not filter event pages by their publication time", async () => {
    const h = harness({ "Announced long ago": { startsAt: "2026-03-05" } });
    h.feed(FEED, [{ title: "Announced long ago", link: "https://example.org/old", published: "2025-11-01T00:00:00Z" }]);

    await h.run();

    expect(h.articles()).toHaveLength(1);
  });

  it("rejects an event that starts after the window", async () => {
    const h = harness({ "Far Away Fair": { startsAt: "2026-03-31" } });
    h.feed(FEED, [{ title: "Far Away Fair", link: "https://example.org/far" }]);

    const run = await h.run();

    expect(h.articles()).toEqual([]);
    expect(h.candidates(run.id, "rejected")).toMatchObject([{ title: "Far Away Fair", reason: "開催日が対象期間の外" }]);
  });

  it("rejects an event that has already ended", async () => {
    const h = harness({ "Last Week": { startsAt: "2026-02-20", endsAt: "2026-02-21" } });
    h.feed(FEED, [{ title: "Last Week", link: "https://example.org/past" }]);

    const run = await h.run();

    expect(h.candidates(run.id, "rejected")).toMatchObject([{ reason: "開催日が対象期間の外" }]);
  });

  it("keeps an event that is under way", async () => {
    const h = harness({ "Winter Festival": { startsAt: "2026-02-25", endsAt: "2026-03-03" } });
    h.feed(FEED, [{ title: "Winter Festival", link: "https://example.org/festival" }]);

    await h.run();

    expect(h.articles()).toHaveLength(1);
  });

  it("rejects a page from which no date can be confirmed", async () => {
    const h = harness({ "Mystery Meetup": { startsAt: null, venue: "Library" } });
    h.feed(FEED, [{ title: "Mystery Meetup", link: "https://example.org/mystery" }]);

    const run = await h.run();

    expect(h.articles()).toEqual([]);
    expect(h.candidates(run.id, "rejected")).toMatchObject([{ title: "Mystery Meetup", reason: "開催日を確認できない" }]);
  });

  it("rejects a page for which the writer returns no event at all", async () => {
    const h = harness({ "Not an event": null });
    h.feed(FEED, [{ title: "Not an event", link: "https://example.org/none" }]);

    const run = await h.run();

    expect(h.candidates(run.id, "rejected")).toMatchObject([{ reason: "開催日を確認できない" }]);
  });

  it("adds a second page about the same event to the existing article", async () => {
    const h = harness({
      "Spring Maker Fair": { startsAt: "2026-03-07T10:00", venue: "City Hall" },
      "Maker fair this weekend": { name: "Spring  Maker Fair!", startsAt: "2026-03-07" },
    });
    h.feed(FEED, [{ title: "Spring Maker Fair", link: "https://example.org/fair" }]);
    await h.run();
    h.clock.advance(24 * 3_600_000);
    h.feed(FEED, [{ title: "Maker fair this weekend", link: "https://example.net/weekend" }]);

    const run = await h.run();

    const articles = h.articles();
    expect(articles).toHaveLength(1);
    expect(articles[0]!.refs.map((ref) => ref.url)).toEqual(["https://example.org/fair", "https://example.net/weekend"]);
    expect(run).toMatchObject({ articlesCreated: 0, articlesUpdated: 1 });
  });

  it("offers the events that have not ended to the grouping step", async () => {
    const h = harness({ "Spring Maker Fair": { startsAt: "2026-03-07" }, "Other Event": { startsAt: "2026-03-06" } });
    h.feed(FEED, [{ title: "Spring Maker Fair", link: "https://example.org/fair" }]);
    await h.run();
    h.feed(FEED, [{ title: "Other Event", link: "https://example.org/other" }]);

    await h.run();

    expect(h.requests.cluster[0]!.prompt).toContain("Spring Maker Fair");
  });

  it("fetches event pages before deciding, because dates are rarely in the snippet", async () => {
    const h = harness({ "Spring Maker Fair": { startsAt: "2026-03-07" } });
    h.feed(FEED, [{ title: "Spring Maker Fair", link: "https://example.org/fair" }]);
    h.page("https://example.org/fair", "The fair opens on March 7 at City Hall.");

    await h.run();

    expect(h.requests.write[0]!.prompt).toContain("The fair opens on March 7 at City Hall.");
  });
});
