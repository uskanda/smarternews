import { blockSite, createRun, insertCandidate, listFeeds } from "@smarternews/core";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const section = () => screen.findByRole("region", { name: "出典のサイト" });

/** Stores candidates of the host collected now: rejected by the judge unless it says otherwise. */
function candidates(server: TestServer, categoryId: number, host: string, count: number, status: "pending" | "rejected" = "rejected") {
  const run = createRun(server.db, { categoryId, trigger: "manual", slot: null }, server.clock);
  for (let i = 0; i < count; i += 1) {
    insertCandidate(server.db, {
      categoryId,
      runId: run.id,
      url: `https://${host}/${Math.random()}`,
      fetchable: true,
      title: "A page",
      snippet: "",
      siteName: "A site",
      siteHost: host,
      publishedAt: null,
      sourceKind: "news-search",
      status,
      reason: "why",
      reasonCode: null,
      importance: 2,
      topicIds: [],
      now: server.clock().toISOString(),
    });
  }
}

const rows = (region: HTMLElement) => within(within(region).getByRole("list", { name: "サイトごとの成績" })).getAllByRole("listitem");

describe("the sites of a category", () => {
  it("follows the stats of the topics, with every site of the last 30 days, the most candidates first", async () => {
    const server = makeServer();
    const category = server.category("Security");
    candidates(server, category.id, "few.example", 1);
    candidates(server, category.id, "many.example", 2);
    candidates(server, category.id, "many.example", 1, "pending");
    candidates(server, category.id, "", 1);
    renderApp({ server, route: `/settings/categories/${category.id}` });

    const region = await section();
    const regions = screen.getAllByRole("region").map((item) => item.getAttribute("aria-label"));
    expect(regions.indexOf("出典のサイト")).toBe(regions.indexOf("トピックの成績") + 1);
    await waitFor(() => expect(rows(region)).toHaveLength(3));
    const [many, few, unknown] = rows(region);
    expect(within(many!).getByRole("heading", { name: "many.example" })).toBeInTheDocument();
    expect(many).toHaveTextContent("候補3件");
    expect(many).toHaveTextContent("採用0件");
    expect(many).toHaveTextContent("除外2件");
    expect(many).toHaveTextContent("記事0件");
    expect(many).toHaveTextContent("外れ0件");
    expect(few).toHaveTextContent("few.example");
    expect(within(unknown!).getByRole("heading", { name: "不明" })).toBeInTheDocument();
    expect(within(unknown!).queryByRole("button")).not.toBeInTheDocument();
  });

  it("says so when the category has no candidates yet", async () => {
    const server = makeServer();
    const category = server.category("Security");
    renderApp({ server, route: `/settings/categories/${category.id}` });

    const region = await section();
    expect(await within(region).findByText("直近30日の候補はまだありません。")).toBeInTheDocument();
  });

  it("blocks a site without asking, lists it first, and stops blocking it", async () => {
    const server = makeServer();
    const category = server.category("Security");
    candidates(server, category.id, "ads.example", 2);
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    const region = await section();
    await user.click(await within(region).findByRole("button", { name: "このサイトを候補から除く", description: "ads.example" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    const blocked = await within(region).findByRole("list", { name: "除外中のサイト" });
    expect(within(blocked).getByText("ads.example")).toBeInTheDocument();
    expect(within(rows(region)[0]!).getByText("除外中")).toBeInTheDocument();
    expect(within(rows(region)[0]!).queryByRole("button", { name: "このサイトを候補から除く" })).not.toBeInTheDocument();
    const unblock = () => within(blocked).getByRole("button", { name: "除外をやめる", description: "ads.example" });
    await waitFor(() => expect(unblock()).toHaveFocus());
    expect(await screen.findByText("ads.example を候補から除きました")).toBeInTheDocument();

    await user.click(unblock());

    await waitFor(() => expect(within(region).queryByRole("list", { name: "除外中のサイト" })).not.toBeInTheDocument());
    expect(server.db.prepare("SELECT count(*) AS n FROM blocked_sites").get()).toEqual({ n: 0 });
    await waitFor(() => expect(within(region).getByRole("button", { name: "このサイトを候補から除く", description: "ads.example" })).toHaveFocus());
  });

  it("lists a blocked site that had no candidates in the period", async () => {
    const server = makeServer();
    const category = server.category("Security");
    blockSite(server.db, category.id, "quiet.example", server.clock());
    renderApp({ server, route: `/settings/categories/${category.id}` });

    const region = await section();
    const blocked = await within(region).findByRole("list", { name: "除外中のサイト" });
    expect(within(blocked).getByText("quiet.example")).toBeInTheDocument();
  });

  it("looks for the feeds of a site in a dialog, in the news category, and adds the one found when asked", async () => {
    const server = makeServer();
    const category = server.category("Security");
    candidates(server, category.id, "blog.example.org", 1);
    server.site.set(
      "https://blog.example.org/",
      () => new Response('<html><head><link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml"></head></html>', { headers: { "content-type": "text/html" } }),
    );
    server.site.set(
      "https://blog.example.org/feed.xml",
      `<?xml version="1.0"?><rss version="2.0"><channel><title>Example Blog</title><item><title>a</title><guid>a</guid><link>https://blog.example.org/a</link></item></channel></rss>`,
    );
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    const region = await section();
    await user.click(await within(region).findByRole("button", { name: "このサイトのフィードを探す", description: "blog.example.org" }));

    const dialog = await screen.findByRole("dialog", { name: "購読フィードを追加" });
    expect(within(dialog).getByLabelText("フィードまたはサイトのURL")).toHaveValue("https://blog.example.org/");
    expect(within(dialog).getByLabelText("カテゴリ")).toHaveDisplayValue("Security");
    const found = await within(dialog).findByRole("group", { name: /フィードが1つ見つかりました/ });
    expect(within(found).getByRole("radio", { name: /Posts/ })).toBeChecked();
    expect(listFeeds(server.db, server.clock())).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "選んだフィードを追加" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(listFeeds(server.db, server.clock())).toMatchObject([{ url: "https://blog.example.org/feed.xml", categoryId: category.id }]);
  });

  it("chooses no category for the feeds of a site found in an event category", async () => {
    const server = makeServer();
    const category = server.category("Events", "event");
    candidates(server, category.id, "events.example.org", 1);
    server.site.set("https://events.example.org/", () => new Response("<html><head></head></html>", { headers: { "content-type": "text/html" } }));
    const { user } = renderApp({ server, route: `/settings/categories/${category.id}` });

    const region = await section();
    await user.click(await within(region).findByRole("button", { name: "このサイトのフィードを探す", description: "events.example.org" }));

    const dialog = await screen.findByRole("dialog", { name: "購読フィードを追加" });
    expect(within(dialog).getByLabelText("カテゴリ")).toHaveDisplayValue(/^なし/);
    expect(await within(dialog).findByText(/このページにフィードは見つかりませんでした/)).toBeInTheDocument();
  });
});
