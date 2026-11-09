import { deleteFeed, getArticle, getFeed, insertFeed, listFeeds, updateFeed } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const nav = () => screen.getByRole("navigation", { name: "項目" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const header = () => list().querySelector("header")!;
const FEED = "https://blog.example.org/feed.xml";

function rss(title: string, keys: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>${title}</title>${keys
    .map((key) => `<item><title>${key}</title><guid>${key}</guid><link>https://blog.example.org/${key}</link><pubDate>Sun, 01 Mar 2026 11:00:00 GMT</pubDate></item>`)
    .join("")}</channel></rss>`;
}
const page = (links: string) => () => new Response(`<html><head>${links}</head></html>`, { headers: { "content-type": "text/html" } });

function feedOf(server: TestServer, title: string, categoryId: number | null = null) {
  return insertFeed(server.db, { url: `https://${title.toLowerCase()}.example.net/feed.xml`, title, categoryId }, server.clock);
}

/** Tools holds a feed with one article and a generated article; Cars holds a generated article; Events is an event category. */
function seeded() {
  const server = makeServer();
  const tools = server.category("Tools");
  const cars = server.category("Cars");
  const events = server.category("Events", "event");
  const blog = feedOf(server, "Blog", tools.id);
  const post = seedFeedArticle(server.db, blog.id, { title: "Old post", at: "2026-03-01T09:00:00.000Z" });
  server.article(tools.id, { title: "Generated" });
  server.article(cars.id, { title: "Car news" });
  server.clock.advance(1);
  return { server, tools, cars, events, blog, post };
}

/** Opens the list of a news category and the dialog for adding a feed from it. */
async function openAddDialog(route: string, server: TestServer) {
  const view = renderApp({ server, route });
  await view.user.click(await within(list()).findByRole("button", { name: "購読フィードを追加" }));
  return { ...view, dialog: await screen.findByRole("dialog", { name: "購読フィードを追加" }) };
}

describe("the button for adding a feed", () => {
  it("is above the list of a news category", async () => {
    const { server, tools } = seeded();
    renderApp({ server, route: `/c/${tools.slug}` });
    expect(await within(list()).findByRole("button", { name: "購読フィードを追加" })).toBeInTheDocument();
  });

  it("is not above the lists of an event category, of a category's generated articles, or of the unread articles", async () => {
    const { server, tools, events } = seeded();
    const view = renderApp({ server, route: `/c/${tools.slug}/generated` });
    await within(list()).findByRole("link", { name: /Generated/ });
    expect(within(header()).queryByRole("button", { name: "購読フィードを追加" })).not.toBeInTheDocument();
    view.unmount();

    const unread = renderApp({ server, route: "/unread" });
    await within(list()).findByRole("link", { name: /Old post/ });
    expect(within(header()).queryByRole("button", { name: "購読フィードを追加" })).not.toBeInTheDocument();
    unread.unmount();

    renderApp({ server, route: `/c/${events.slug}` });
    await screen.findByRole("heading", { level: 1, name: "Events" });
    expect(screen.queryByRole("button", { name: "購読フィードを追加" })).not.toBeInTheDocument();
  });
});

describe("adding a feed from the list of a category", () => {
  it("opens over the list with the category chosen and the focus in the URL field", async () => {
    const { server, tools } = seeded();
    const { dialog } = await openAddDialog(`/c/${tools.slug}`, server);
    expect(within(dialog).getByLabelText("カテゴリ")).toHaveDisplayValue("Tools");
    await waitFor(() => expect(within(dialog).getByLabelText("フィードまたはサイトのURL")).toHaveFocus());
    // The list stays behind the dialog, hidden from assistive technology while the dialog is open.
    expect(screen.getByRole("region", { name: "記事の一覧", hidden: true })).toBeInTheDocument();
    expect(within(dialog).getByText("要約にはLLMを使います。これから届く記事だけを要約します。")).toBeInTheDocument();
  });

  it("subscribes, closes, puts the feed below the category and keeps the list", async () => {
    const { server, tools } = seeded();
    server.site.set(FEED, rss("Example Blog", ["a"]));
    const view = await openAddDialog(`/c/${tools.slug}`, server);
    await view.user.type(within(view.dialog).getByLabelText("フィードまたはサイトのURL"), FEED);
    await view.user.click(within(view.dialog).getByRole("button", { name: "購読フィードを追加" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent("「Example Blog」を追加しました");
    expect(listFeeds(server.db).find((feed) => feed.url === FEED)).toMatchObject({ categoryId: tools.id });
    await within(nav()).findByRole("link", { name: /Example Blog/ });
    expect(view.path()).toBe(`/c/${tools.slug}`);
    await waitFor(() => expect(within(list()).getByRole("button", { name: "購読フィードを追加" })).toHaveFocus());
  });

  it("subscribes in another category when one is chosen, and keeps the list it was opened from", async () => {
    const { server, tools, cars } = seeded();
    server.site.set(FEED, rss("Example Blog", ["a"]));
    const view = await openAddDialog(`/c/${tools.slug}`, server);
    await view.user.type(within(view.dialog).getByLabelText("フィードまたはサイトのURL"), FEED);
    await view.user.selectOptions(within(view.dialog).getByLabelText("カテゴリ"), "Cars");
    await view.user.click(within(view.dialog).getByRole("button", { name: "購読フィードを追加" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(listFeeds(server.db).find((feed) => feed.url === FEED)).toMatchObject({ categoryId: cars.id });
    expect(view.path()).toBe(`/c/${tools.slug}`);
  });

  it("lets the user choose one of the feeds a page points to", async () => {
    const { server, tools } = seeded();
    server.site.set(
      "https://blog.example.org/",
      page('<link rel="alternate" type="application/rss+xml" title="Posts" href="/feed.xml"><link rel="alternate" type="application/atom+xml" title="Comments" href="/comments.xml">'),
    );
    server.site.set("https://blog.example.org/comments.xml", rss("Comments Feed", ["c"]));
    const view = await openAddDialog(`/c/${tools.slug}`, server);
    await view.user.type(within(view.dialog).getByLabelText("フィードまたはサイトのURL"), "https://blog.example.org/");
    await view.user.click(within(view.dialog).getByRole("button", { name: "購読フィードを追加" }));

    const choices = await within(view.dialog).findByRole("group", { name: /フィードが2つ見つかりました/ });
    expect(choices).toHaveTextContent("https://blog.example.org/feed.xml");
    await view.user.click(within(choices).getByRole("radio", { name: /Comments/ }));
    await view.user.click(within(view.dialog).getByRole("button", { name: "選んだフィードを追加" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(listFeeds(server.db).map((feed) => feed.url)).toContain("https://blog.example.org/comments.xml");
    expect(listFeeds(server.db).map((feed) => feed.url)).not.toContain(FEED);
  });

  it("offers to subscribe to a page without a feed", async () => {
    const { server, tools } = seeded();
    server.site.set("https://blog.example.org/", page("<title>Blog</title>"));
    const view = await openAddDialog(`/c/${tools.slug}`, server);
    await view.user.type(within(view.dialog).getByLabelText("フィードまたはサイトのURL"), "https://blog.example.org/");
    await view.user.click(within(view.dialog).getByRole("button", { name: "購読フィードを追加" }));

    expect(await within(view.dialog).findByText(/このページにフィードは見つかりませんでした。/)).toBeInTheDocument();
    expect(within(view.dialog).getByRole("button", { name: "このページを購読する" })).toBeInTheDocument();
  });

  it("stays open with the URL and the reason when the feed is already subscribed", async () => {
    const { server, tools } = seeded();
    server.site.set(FEED, rss("Example Blog", ["a"]));
    insertFeed(server.db, { url: FEED, title: "Example Blog" }, server.clock);
    const view = await openAddDialog(`/c/${tools.slug}`, server);
    await view.user.type(within(view.dialog).getByLabelText("フィードまたはサイトのURL"), FEED);
    await view.user.click(within(view.dialog).getByRole("button", { name: "購読フィードを追加" }));

    expect(await within(view.dialog).findByText(`このフィードはすでに購読しています（${FEED}）。`)).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "購読フィードを追加" })).toBeInTheDocument();
    expect(within(view.dialog).getByLabelText("フィードまたはサイトのURL")).toHaveValue(FEED);
  });

  it("subscribes to nothing when closed with Escape, and starts empty when opened again", async () => {
    const { server, tools } = seeded();
    const before = listFeeds(server.db).length;
    const view = await openAddDialog(`/c/${tools.slug}`, server);
    await view.user.type(within(view.dialog).getByLabelText("フィードまたはサイトのURL"), FEED);
    await view.user.selectOptions(within(view.dialog).getByLabelText("カテゴリ"), "Cars");
    await view.user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(listFeeds(server.db)).toHaveLength(before);
    await waitFor(() => expect(within(list()).getByRole("button", { name: "購読フィードを追加" })).toHaveFocus());

    await view.user.click(within(list()).getByRole("button", { name: "購読フィードを追加" }));
    const again = await screen.findByRole("dialog", { name: "購読フィードを追加" });
    expect(within(again).getByLabelText("フィードまたはサイトのURL")).toHaveValue("");
    expect(within(again).getByLabelText("カテゴリ")).toHaveDisplayValue("Tools");
  });
});

describe("the button for the settings of a feed", () => {
  it("is above the list of a feed only", async () => {
    const { server, tools, blog } = seeded();
    const view = renderApp({ server, route: `/f/${blog.id}` });
    expect(await within(list()).findByRole("button", { name: "購読フィードの設定" })).toBeInTheDocument();
    view.unmount();

    for (const route of [`/c/${tools.slug}`, "/unread"]) {
      const other = renderApp({ server, route });
      await within(list()).findByRole("link", { name: /Old post/ });
      expect(within(header()).queryByRole("button", { name: "購読フィードの設定" })).not.toBeInTheDocument();
      other.unmount();
    }
  });
});

describe("the settings of a feed from its list", () => {
  async function openOptions(server: TestServer, feedId: number) {
    const view = renderApp({ server, route: `/f/${feedId}` });
    await view.user.click(await within(list()).findByRole("button", { name: "購読フィードの設定" }));
    return { ...view, dialog: await screen.findByRole("dialog", { name: "購読フィードの設定" }) };
  }

  it("shows the three switches with the feed's values and what each means", async () => {
    const { server, blog } = seeded();
    updateFeed(server.db, blog.id, { translate: true });
    const { dialog } = await openOptions(server, blog.id);

    expect(within(dialog).getByRole("checkbox", { name: "自動で要約する" })).not.toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "翻訳する" })).toBeChecked();
    expect(within(dialog).getByRole("checkbox", { name: "全文を取得する" })).not.toBeChecked();
    expect(dialog).toHaveTextContent("要約にはLLMを使います。これから届く記事だけを要約します。");
    expect(dialog).toHaveTextContent("記事のタイトルと本文を、翻訳のためにGoogleまたは設定したLLMのサービスへ送ります。");
    expect(dialog).toHaveTextContent("記事ごとに元のページを取得して、本文を保存します。これから届く記事だけが対象です。");
    expect(dialog).not.toHaveTextContent("ページから得るのは記事のタイトル、リンク、日時だけです。");
  });

  it("says what a web feed takes from its page beside the full content switch", async () => {
    const { server, tools } = seeded();
    const web = insertFeed(
      server.db,
      { url: "https://news.example.org/", title: "Web", format: "page", selectors: { item: "li" }, categoryId: tools.id },
      server.clock,
    );
    const { dialog } = await openOptions(server, web.id);
    expect(dialog).toHaveTextContent("ページから得るのは記事のタイトル、リンク、日時だけです。本文は、全文の取得で得ます。");
  });

  it("saves the three switches only, closes and gives the focus back", async () => {
    const { server, tools, blog } = seeded();
    updateFeed(server.db, blog.id, { intervalMinutes: 120, title: "My blog" });
    const view = await openOptions(server, blog.id);
    await view.user.click(within(view.dialog).getByRole("checkbox", { name: "自動で要約する" }));
    await view.user.click(within(view.dialog).getByRole("checkbox", { name: "翻訳する" }));
    await view.user.click(within(view.dialog).getByRole("button", { name: "保存する" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent("購読フィードを保存しました");
    expect(getFeed(server.db, blog.id)).toMatchObject({
      autoSummarize: true,
      translate: true,
      fetchFullContent: false,
      intervalMinutes: 120,
      title: "My blog",
      categoryId: tools.id,
      enabled: true,
    });
    await waitFor(() => expect(within(list()).getByRole("button", { name: "購読フィードの設定" })).toHaveFocus());
  });

  it("changes nothing when closed without saving", async () => {
    const { server, blog } = seeded();
    const view = await openOptions(server, blog.id);
    await view.user.click(within(view.dialog).getByRole("checkbox", { name: "翻訳する" }));
    await view.user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(getFeed(server.db, blog.id).translate).toBe(false);

    await view.user.click(within(list()).getByRole("button", { name: "購読フィードの設定" }));
    expect(within(await screen.findByRole("dialog", { name: "購読フィードの設定" })).getByRole("checkbox", { name: "翻訳する" })).not.toBeChecked();
  });

  it("stays open with the reason when the feed is gone", async () => {
    const { server, blog } = seeded();
    const view = await openOptions(server, blog.id);
    await view.user.click(within(view.dialog).getByRole("checkbox", { name: "翻訳する" }));
    deleteFeed(server.db, blog.id);
    await view.user.click(within(view.dialog).getByRole("button", { name: "保存する" }));

    expect(await within(view.dialog).findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "購読フィードの設定" })).toBeInTheDocument();
    expect(within(view.dialog).getByRole("checkbox", { name: "翻訳する" })).toBeChecked();
  });

  it("goes to the feed's form among the settings of feeds, dropping the switches it did not save", async () => {
    const { server, blog } = seeded();
    const view = await openOptions(server, blog.id);
    await view.user.click(within(view.dialog).getByRole("checkbox", { name: "翻訳する" }));
    await view.user.click(within(view.dialog).getByRole("link", { name: "ほかの設定" }));

    expect(await screen.findByRole("heading", { level: 1, name: "購読フィード" })).toBeInTheDocument();
    expect(view.path()).toBe("/settings/feeds");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const row = (await within(screen.getByRole("region", { name: "購読フィードの一覧" })).findByText("Blog")).closest("li")!;
    await waitFor(() => expect(within(row).getByLabelText("名前")).toHaveFocus());
    expect(within(row).getByRole("checkbox", { name: "翻訳する" })).not.toBeChecked();
    expect(getFeed(server.db, blog.id).translate).toBe(false);
    expect(view.requests.filter((request) => request.startsWith("PATCH"))).toEqual([]);
  });
});

describe("unsubscribing from the settings of a feed", () => {
  async function openUnsubscribe(server: TestServer, feedId: number) {
    const view = renderApp({ server, route: `/f/${feedId}` });
    await view.user.click(await within(list()).findByRole("button", { name: "購読フィードの設定" }));
    const dialog = await screen.findByRole("dialog", { name: "購読フィードの設定" });
    await view.user.click(within(dialog).getByRole("button", { name: "Blogの登録を解除" }));
    return { ...view, question: await screen.findByRole("alertdialog", { name: "購読フィードの登録を解除しますか" }) };
  }

  it("closes the settings and asks with what goes with the feed", async () => {
    const { server, blog } = seeded();
    const { question } = await openUnsubscribe(server, blog.id);

    expect(screen.queryByRole("dialog", { name: "購読フィードの設定" })).not.toBeInTheDocument();
    expect(question).toHaveTextContent("「Blog」と、その配信記事1件が消えます。");
    expect(question).toHaveTextContent("元に戻せません。");
    expect(question).toHaveTextContent("記事を残したまま取得だけを止めるには、設定の購読フィードで一時停止にしてください。");
    await waitFor(() => expect(within(question).getByRole("button", { name: "やめる" })).toHaveFocus());
  });

  it("unsubscribes, drops the feed from the left pane and opens the unread articles", async () => {
    const { server, blog } = seeded();
    const view = await openUnsubscribe(server, blog.id);
    await view.user.click(within(view.question).getByRole("button", { name: "登録を解除する" }));

    await waitFor(() => expect(view.path()).toBe("/unread"));
    expect(await screen.findByRole("status")).toHaveTextContent("購読フィードの登録を解除しました");
    expect(listFeeds(server.db).map((feed) => feed.id)).not.toContain(blog.id);
    await waitFor(() => expect(within(nav()).queryByRole("link", { name: /Blog/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the feed and gives the focus back when the question is declined", async () => {
    const { server, blog } = seeded();
    const view = await openUnsubscribe(server, blog.id);
    await view.user.click(within(view.question).getByRole("button", { name: "やめる" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(getFeed(server.db, blog.id)).toBeDefined();
    expect(view.path()).toBe(`/f/${blog.id}`);
    await waitFor(() => expect(within(list()).getByRole("button", { name: "購読フィードの設定" })).toHaveFocus());
  });

  it("says so and keeps the list when the feed cannot be unsubscribed", async () => {
    const { server, blog } = seeded();
    const view = await openUnsubscribe(server, blog.id);
    deleteFeed(server.db, blog.id);
    await view.user.click(within(view.question).getByRole("button", { name: "登録を解除する" }));

    expect(await screen.findByRole("status")).toHaveTextContent("登録を解除できませんでした。もう一度試してください。");
    expect(view.path()).toBe(`/f/${blog.id}`);
  });
});

describe("keys while a dialog is open", () => {
  it("does not move through the list behind the dialog for adding a feed", async () => {
    const { server, tools } = seeded();
    const view = await openAddDialog(`/c/${tools.slug}`, server);
    within(view.dialog).getByRole("button", { name: "閉じる" }).focus();
    await view.user.keyboard("j");

    expect(view.path()).toBe(`/c/${tools.slug}`);
    expect(screen.getByRole("dialog", { name: "購読フィードを追加" })).toBeInTheDocument();
  });

  it("does not star the article behind the question before unsubscribing", async () => {
    const { server, blog, post } = seeded();
    const view = renderApp({ server, route: `/f/${blog.id}/${post}` });
    await screen.findByRole("article", { name: "記事" });
    fireEvent.contextMenu(within(nav()).getByRole("link", { name: /Blog/ }));
    await view.user.click(await screen.findByRole("menuitem", { name: "登録を解除" }));
    await screen.findByRole("alertdialog");
    await view.user.keyboard("s");

    expect(getArticle(server.db, post).starred).toBe(false);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("still moves between the entries in the left pane on a narrow screen", async () => {
    const { server } = seeded();
    const view = renderApp({ server, route: "/unread", width: 390 });
    await view.user.click(await screen.findByRole("button", { name: "項目を開く" }));
    const drawer = await screen.findByRole("dialog", { name: "項目" });
    within(drawer).getByRole("link", { name: /^未読/ }).focus();
    await view.user.keyboard("{Shift>}J{/Shift}");

    await waitFor(() => expect(view.path()).toBe("/all"));
  });
});
