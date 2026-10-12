import { insertFeed, saveAutoSummary, setArticleFlags, updateFeed } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const nav = () => screen.getByRole("navigation", { name: "項目" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const article = () => screen.getByRole("article", { name: "記事" });
/** The article pane, once the article has arrived. */
const opened = () => screen.findByRole("article", { name: "記事" });
const rowTitles = () => within(list()).queryAllByRole("listitem").map((item) => item.querySelector("[data-title]")?.textContent);
const row = (title: RegExp) => within(list()).getByRole("link", { name: title }).closest("li")!;
/** The entries of the navigation as "label count", in order, without the two management links. */
const navLines = () =>
  within(nav())
    .getAllByRole("link")
    .map((link) => link.textContent!.replace(/\s+/g, " ").trim())
    .filter((text) => text !== "設定" && text !== "実行履歴");

const at = (minutes: number) => new Date(Date.parse("2026-03-01T10:00:00.000Z") + minutes * 60_000).toISOString();

function feedOf(server: TestServer, title: string, categoryId: number | null = null) {
  return insertFeed(server.db, { url: `https://${title.toLowerCase().replace(/\W+/g, "-")}.example.org/feed.xml`, title, categoryId }, server.clock);
}

/**
 * Tools holds one generated article and two feeds; Cars holds only a generated article; one feed has no
 * category. Times run from "Old post" to "Generated", the newest.
 */
function seeded() {
  const server = makeServer();
  const tools = server.category("Tools");
  const cars = server.category("Cars");
  const blog = feedOf(server, "Blog", tools.id);
  const releases = feedOf(server, "Releases", tools.id);
  const loose = feedOf(server, "Loose", null);
  const oldPost = seedFeedArticle(server.db, blog.id, { title: "Old post", at: at(0), body: "Old words." });
  const newPost = seedFeedArticle(server.db, blog.id, { title: "New post", at: at(60), body: "New words.", author: "Kim Author", url: "https://blog.example.org/new" });
  const release = seedFeedArticle(server.db, releases.id, { title: "Release 2", at: at(30) });
  const stray = seedFeedArticle(server.db, loose.id, { title: "Stray", at: at(10) });
  const generated = server.article(tools.id, { title: "Generated", importance: 5 });
  const carNews = server.article(cars.id, { title: "Car news" });
  return { server, tools, cars, blog, releases, loose, oldPost, newPost, release, stray, generated, carNews };
}

describe("the entries of the navigation", () => {
  it("lists the generated articles and the feeds below a category that has feeds, with unread counts", async () => {
    const { server } = seeded();
    renderApp({ server });
    await within(nav()).findByRole("link", { name: /Blog/ });
    await waitFor(() =>
      expect(navLines()).toEqual(["未読6", "すべて", "スター", "AI生成2", "Tools4", "AI生成1", "Blog2", "Releases1", "Cars1", "未分類1", "Loose1"]),
    );
  });

  it("puts nothing below a category without feeds, and has no 未分類 without loose feeds", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    server.article(tools.id);
    renderApp({ server });
    await within(nav()).findByRole("link", { name: /Tools/ });
    await waitFor(() => expect(navLines()).toEqual(["未読1", "すべて", "スター", "AI生成1", "Tools1"]));
    expect(within(nav()).queryByRole("button")).not.toBeInTheDocument();
  });

  it("folds the entries below a category, keeps the category's count, and remembers it", async () => {
    const { server } = seeded();
    const first = renderApp({ server });
    const fold = await within(nav()).findByRole("button", { name: "Toolsの下の項目" });
    expect(fold).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(fold.getAttribute("aria-controls")!)).toContainElement(within(nav()).getByRole("link", { name: /Blog/ }));

    await first.user.click(fold);

    expect(within(nav()).queryByRole("link", { name: /Blog/ })).not.toBeInTheDocument();
    expect(within(nav()).getByRole("link", { name: /^Tools/ })).toHaveTextContent("4");
    expect(within(nav()).getByRole("link", { name: /Loose/ })).toBeInTheDocument();
    expect(within(nav()).getByRole("button", { name: "Toolsの下の項目" })).toHaveAttribute("aria-expanded", "false");

    first.unmount();
    renderApp({ server });
    await within(nav()).findByRole("link", { name: /^Tools/ });
    expect(within(nav()).queryByRole("link", { name: /Blog/ })).not.toBeInTheDocument();
  });

  it("folds and unfolds with the keyboard", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server });
    const fold = await within(nav()).findByRole("button", { name: "Toolsの下の項目" });
    fold.focus();
    await user.keyboard("{Enter}");
    expect(within(nav()).queryByRole("link", { name: /Blog/ })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(within(nav()).getByRole("link", { name: /Blog/ })).toBeInTheDocument();
  });

  it("is a list of lists, so that what is below a category is below it for a screen reader too", async () => {
    const { server } = seeded();
    renderApp({ server });
    const blog = await within(nav()).findByRole("link", { name: /Blog/ });
    const group = blog.closest("ul")!;
    expect(group.closest("li")).toContainElement(within(nav()).getByRole("link", { name: /^Tools/ }));
    expect(within(group).getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows on a folded category that the open list is inside it", async () => {
    const { server, blog } = seeded();
    const { user } = renderApp({ server, route: `/f/${blog.id}` });
    const tools = await within(nav()).findByRole("link", { name: /^Tools/ });
    expect(tools).not.toHaveClass("bg-selected");

    await user.click(within(nav()).getByRole("button", { name: "Toolsの下の項目" }));

    expect(within(nav()).getByRole("link", { name: /^Tools/ })).toHaveClass("bg-selected");
  });

  it("marks only the entry that is open as current", async () => {
    const { server, blog } = seeded();
    renderApp({ server, route: `/f/${blog.id}` });
    const current = await waitFor(() => {
      const links = within(nav()).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
      expect(links).toHaveLength(1);
      return links[0]!;
    });
    expect(current).toHaveTextContent("Blog");
  });
});

describe("the list an entry opens", () => {
  it("mixes the generated articles and the feed articles of a category, newest first", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server });
    await user.click(await within(nav()).findByRole("link", { name: /^Tools/ }));
    await screen.findByRole("heading", { level: 1, name: "Tools" });
    await waitFor(() => expect(rowTitles()).toEqual(["Generated", "New post", "Release 2", "Old post"]));
  });

  it("shows only the unread articles of the feed that is chosen", async () => {
    const { server, oldPost } = seeded();
    setArticleFlags(server.db, oldPost, { isRead: true });
    const { user, path } = renderApp({ server });
    await user.click(await within(nav()).findByRole("link", { name: /Blog/ }));
    await screen.findByRole("heading", { level: 1, name: "Blog" });
    await waitFor(() => expect(rowTitles()).toEqual(["New post"]));
    expect(path()).toMatch(/^\/f\/\d+$/);

    await user.click(screen.getByRole("checkbox", { name: "既読も表示" }));
    await waitFor(() => expect(rowTitles()).toEqual(["New post", "Old post"]));
  });

  it("shows only generated articles of every category under the top AI生成", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server });
    await user.click((await within(nav()).findAllByRole("link", { name: /^AI生成/ }))[0]!);
    await screen.findByRole("heading", { level: 1, name: "AI生成" });
    await waitFor(() => expect(rowTitles()).toEqual(["Car news", "Generated"]));
  });

  it("shows only the generated articles of the category under its AI生成", async () => {
    const { server } = seeded();
    const { user, path } = renderApp({ server });
    await within(nav()).findByRole("link", { name: /Blog/ });
    await user.click(within(nav()).getAllByRole("link", { name: /^AI生成/ })[1]!);
    await screen.findByRole("heading", { level: 1, name: "ToolsのAI生成" });
    await waitFor(() => expect(rowTitles()).toEqual(["Generated"]));
    expect(path()).toBe("/c/tools/generated");
  });

  it("shows the articles of the feeds without a category under 未分類", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server });
    await user.click(await within(nav()).findByRole("link", { name: /未分類/ }));
    await screen.findByRole("heading", { level: 1, name: "未分類" });
    await waitFor(() => expect(rowTitles()).toEqual(["Stray"]));
  });

  it("opens the same list and article again after a reload", async () => {
    const { server, blog, newPost } = seeded();
    renderApp({ server, route: `/f/${blog.id}/${newPost}` });
    expect(await within(await opened()).findByRole("heading", { level: 2, name: "New post" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Blog" })).toBeInTheDocument();
  });

  it("says so when the feed does not exist", async () => {
    const { server } = seeded();
    renderApp({ server, route: "/f/999" });
    expect(await screen.findByText("この購読フィードはありません。")).toBeInTheDocument();
  });

  it("does not offer the importance filter where there are only feed articles", async () => {
    const { server, blog } = seeded();
    renderApp({ server, route: `/f/${blog.id}` });
    await screen.findByRole("heading", { level: 1, name: "Blog" });
    expect(screen.queryByRole("checkbox", { name: "重要度4以上だけ" })).not.toBeInTheDocument();
  });

  it("leaves feed articles out when only importance four and up is asked for", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: "/c/tools" });
    await screen.findByRole("link", { name: /New post/ });
    await user.click(screen.getByRole("checkbox", { name: "重要度4以上だけ" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Generated"]));
  });
});

describe("a feed article in the list", () => {
  it("shows the headline, the start of the content, the feed's name and the time, and no importance or source count", async () => {
    const { server } = seeded();
    renderApp({ server, route: "/c/tools" });
    await screen.findByRole("link", { name: /New post/ });
    const line = row(/New post/);
    expect(line).toHaveTextContent("New words.");
    expect(line).toHaveTextContent("Blog");
    expect(line).toHaveTextContent("11:00");
    expect(line).not.toHaveTextContent("出典");
    expect(line).not.toHaveAttribute("data-importance");
    // The generated article beside it keeps both.
    expect(row(/Generated/)).toHaveTextContent("出典1件");
    expect(row(/Generated/)).toHaveAttribute("data-importance", "5");
  });
});

describe("a feed article that is opened", () => {
  it("shows the headline, the feed, the author, when it was published, the content, and the way to its page first", async () => {
    const { server, blog, newPost } = seeded();
    renderApp({ server, route: `/f/${blog.id}/${newPost}` });
    const pane = await opened();
    await within(pane).findByRole("heading", { level: 2, name: "New post" });
    expect(pane).toHaveTextContent("Blog");
    expect(pane).toHaveTextContent("Kim Author");
    expect(pane).toHaveTextContent("2026年3月1日 11:00 に公開");
    expect(pane).not.toHaveTextContent("重要度");
    const open = within(pane).getByRole("link", { name: "元のページを開く" });
    expect(open).toHaveAttribute("href", "https://blog.example.org/new");
    expect(open).toHaveAttribute("target", "_blank");
    const content = within(pane).getByText("New words.");
    expect(open.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is marked as read, and stays in the unread list until the list changes", async () => {
    const { server, blog, newPost } = seeded();
    const { user } = renderApp({ server, route: `/f/${blog.id}` });
    await user.click(await screen.findByRole("link", { name: /New post/ }));
    await within(await opened()).findByRole("heading", { level: 2, name: "New post" });
    await waitFor(() => expect(row(/New post/)).toHaveAttribute("data-read", "true"));
    expect(rowTitles()).toEqual(["New post", "Old post"]);
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /Blog/ })).toHaveTextContent("Blog1"));
    expect(newPost).toBeGreaterThan(0);
  });

  it("opens its page with the o key, and takes a star with s", async () => {
    const { server, blog, newPost } = seeded();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { user } = renderApp({ server, route: `/f/${blog.id}/${newPost}` });
    await within(await opened()).findByRole("heading", { level: 2, name: "New post" });

    await user.keyboard("o");
    expect(open).toHaveBeenCalledWith("https://blog.example.org/new", "_blank", "noopener,noreferrer");

    await user.keyboard("s");
    expect(await within(await opened()).findByRole("button", { name: "スターを外す" })).toBeInTheDocument();
    open.mockRestore();
  });
});

describe("images", () => {
  function withImage(body: string, origin: "feed" | "generated" = "feed") {
    const server = makeServer();
    const tools = server.category("Tools");
    const id =
      origin === "feed"
        ? seedFeedArticle(server.db, feedOf(server, "Blog", tools.id).id, { title: "Pictures", body })
        : server.article(tools.id, { title: "Pictures", body });
    return { server, route: `/c/tools/${id}` };
  }

  it("are shown in the content of a feed article, without sending where the reader comes from", async () => {
    renderApp(withImage("Before.\n\n![A chart](https://img.example.org/a.png)\n\nAfter."));
    const image = await within(await opened()).findByRole("img", { name: "A chart" });
    expect(image).toHaveAttribute("src", "https://img.example.org/a.png");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveClass("article-image");
  });

  it("give way to their description when they cannot be loaded, and the words stay readable", async () => {
    renderApp(withImage("Before.\n\n![A chart](https://img.example.org/a.png)\n\nAfter."));
    const image = await within(await opened()).findByRole("img", { name: "A chart" });

    fireEvent.error(image);

    expect(within(article()).queryByRole("img")).not.toBeInTheDocument();
    expect(within(article()).getByText("A chart")).toBeInTheDocument();
    expect(within(article()).getByText("After.")).toBeInTheDocument();
  });

  it("are not loaded over plain HTTP", async () => {
    renderApp(withImage("Text.\n\n![Plain](http://img.example.org/b.png)"));
    await within(await opened()).findByText("Text.");
    expect(within(article()).queryByRole("img")).not.toBeInTheDocument();
  });

  it("are never loaded in a generated article: only the description is shown", async () => {
    renderApp(withImage("Text.\n\n![Described](https://img.example.org/a.png)", "generated"));
    await within(await opened()).findByText("Text.");
    expect(within(article()).queryByRole("img")).not.toBeInTheDocument();
    expect(within(article()).getByText("Described")).toBeInTheDocument();
  });
});

describe("marking everything read", () => {
  it("marks only the articles of the feed that is open, and can be undone", async () => {
    const { server, blog } = seeded();
    const { user } = renderApp({ server, route: `/f/${blog.id}` });
    await screen.findByRole("link", { name: /New post/ });

    await user.click(screen.getByRole("button", { name: "すべて既読にする" }));

    expect(await screen.findByText("2件を既読にしました")).toBeInTheDocument();
    await waitFor(() => expect(navLines()).toEqual(["未読4", "すべて", "スター", "AI生成2", "Tools2", "AI生成1", "Blog", "Releases1", "Cars1", "未分類1", "Loose1"]));

    await user.click(screen.getByRole("button", { name: "取り消す" }));
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /Blog/ })).toHaveTextContent("Blog2"));
  });

  it("marks only generated articles under the top AI生成", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: "/generated" });
    await screen.findByRole("link", { name: /Car news/ });
    await user.click(screen.getByRole("button", { name: "すべて既読にする" }));
    expect(await screen.findByText("2件を既読にしました")).toBeInTheDocument();
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /Blog/ })).toHaveTextContent("Blog2"));
  });

  it("marks only the articles of feeds without a category under 未分類", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: "/uncategorized" });
    await screen.findByRole("link", { name: /Stray/ });
    await user.click(screen.getByRole("button", { name: "すべて既読にする" }));
    expect(await screen.findByText("1件を既読にしました")).toBeInTheDocument();
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("未読5"));
  });
});

describe("a heading in the content of a feed article", () => {
  it("never outranks the headline of the article", async () => {
    const server = makeServer();
    const tools = server.category("Tools");
    const id = seedFeedArticle(server.db, feedOf(server, "Blog", tools.id).id, { title: "Post", body: "# Inside\n\nText." });
    renderApp({ server, route: `/c/tools/${id}` });
    expect(await within(await opened()).findByRole("heading", { level: 2, name: "Inside" })).toBeInTheDocument();
    expect(within(article()).queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });
});

describe("the summary of a feed article", () => {
  const NOTE = "元のページを読めなかったため、配信された内容だけをもとにしています。";
  const WAITING = "AIによる要約を作っています。";
  const summaryOf = (pane: HTMLElement) => within(pane).queryByRole("region", { name: "AIによる要約" });

  it("stands under its own heading before the content, after the way to the page", async () => {
    const { server, blog, newPost } = seeded();
    saveAutoSummary(server.db, newPost, { text: "The post in three lines.", source: "page", now: at(70) });
    renderApp({ server, route: `/f/${blog.id}/${newPost}` });
    const pane = await opened();
    const content = await within(pane).findByText("New words.");

    const summary = summaryOf(pane)!;
    expect(within(summary).getByRole("heading", { level: 3, name: "AIによる要約" })).toBeInTheDocument();
    expect(summary).toHaveTextContent("The post in three lines.");
    expect(summary).not.toHaveTextContent(NOTE);
    expect(within(pane).getByRole("link", { name: "元のページを開く" }).compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is not there for an article without one, and the content follows the way to the page as before", async () => {
    const { server, blog, newPost } = seeded();
    renderApp({ server, route: `/f/${blog.id}/${newPost}` });
    const pane = await opened();
    await within(pane).findByText("New words.");
    expect(summaryOf(pane)).toBeNull();
    expect(pane).not.toHaveTextContent(WAITING);
    expect(within(pane).getByRole("link", { name: "元のページを開く" }).parentElement!.nextElementSibling).toHaveClass("article-body");
  });

  it("says that the page could not be read when it was written from what the feed delivered", async () => {
    const { server, blog, newPost } = seeded();
    saveAutoSummary(server.db, newPost, { text: "Only the excerpt.", source: "feed", now: at(70) });
    renderApp({ server, route: `/f/${blog.id}/${newPost}` });
    const pane = await opened();
    await within(pane).findByText("New words.");
    expect(summaryOf(pane)).toHaveTextContent(NOTE);
  });

  it("shows tags in it as the characters they are, and loads no image from it", async () => {
    const { server, blog, newPost } = seeded();
    const text = 'Before <script>window.hacked = true</script> <img src="https://img.example.org/x.png"> ![alt](https://img.example.org/y.png) after';
    saveAutoSummary(server.db, newPost, { text, source: "page", now: at(70) });
    renderApp({ server, route: `/f/${blog.id}/${newPost}` });
    const pane = await opened();
    await within(pane).findByText("New words.");

    const summary = summaryOf(pane)!;
    expect(summary).toHaveTextContent("<script>window.hacked = true</script>");
    expect(summary.querySelector("script, img")).toBeNull();
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it("says before the content that the summary is being made while the article waits for it", async () => {
    const { server, blog } = seeded();
    server.clock.advance(60_000);
    updateFeed(server.db, blog.id, { autoSummarize: true }, server.clock);
    server.clock.advance(60_000);
    const fresh = seedFeedArticle(server.db, blog.id, { title: "Fresh post", at: server.clock().toISOString(), body: "Fresh words." });
    renderApp({ server, route: `/f/${blog.id}/${fresh}` });
    const pane = await opened();
    const content = await within(pane).findByText("Fresh words.");

    const note = within(pane).getByRole("status");
    expect(note).toHaveTextContent(WAITING);
    expect(note.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summaryOf(pane)).toBeNull();
  });

  /** A feed that summarises, and an article that arrived after that was switched on. */
  function waitingArticle(options: Parameters<typeof makeServer>[1] = {}) {
    const server = makeServer(undefined, options);
    const blog = feedOf(server, "Blog", null);
    server.clock.advance(60_000);
    updateFeed(server.db, blog.id, { autoSummarize: true }, server.clock);
    server.clock.advance(60_000);
    const fresh = seedFeedArticle(server.db, blog.id, { title: "Fresh post", at: server.clock().toISOString(), body: "Fresh words. ".repeat(30) });
    return { server, blog, fresh };
  }

  it("asks for the summary of the article it opens, and shows it within seconds although the article is read by then", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { server, blog, fresh } = waitingArticle({ summarize: () => ({ summary: "Asked for and written." }) });
      const { requests } = renderApp({ server, route: `/f/${blog.id}/${fresh}` });
      const pane = await opened();
      expect(await within(pane).findByRole("status")).toHaveTextContent(WAITING);
      await waitFor(() => expect(requests).toContain(`POST /api/v1/articles/${fresh}/summary`));
      await waitFor(() => expect(server.db.prepare("SELECT is_read FROM articles WHERE id = ?").get(fresh)).toEqual({ is_read: 1 }));
      await server.summarizer.idle();

      await vi.advanceTimersByTimeAsync(5_500);
      await waitFor(() => expect(summaryOf(pane)).toHaveTextContent("Asked for and written."));
      expect(pane).not.toHaveTextContent(WAITING);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says that the day has no summaries left instead of that one is being made", async () => {
    const { server, blog, fresh } = waitingArticle({ summariesPerDay: 0 });
    renderApp({ server, route: `/f/${blog.id}/${fresh}` });
    const pane = await opened();
    expect(await within(pane).findByText("今日の要約の上限に達しました。この記事の要約は、明日以降に作ります。")).toBeInTheDocument();
    expect(pane).not.toHaveTextContent(WAITING);
  });

  it("shows the summary on the article that stays open, once it has arrived", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { server, blog } = seeded();
      server.clock.advance(60_000);
      updateFeed(server.db, blog.id, { autoSummarize: true }, server.clock);
      server.clock.advance(60_000);
      const fresh = seedFeedArticle(server.db, blog.id, { title: "Fresh post", at: server.clock().toISOString(), body: "Fresh words." });
      renderApp({ server, route: `/f/${blog.id}/${fresh}` });
      const pane = await opened();
      expect(await within(pane).findByRole("status")).toHaveTextContent(WAITING);

      saveAutoSummary(server.db, fresh, { text: "It has arrived.", source: "page", now: server.clock().toISOString() });
      await vi.advanceTimersByTimeAsync(61_000);

      await waitFor(() => expect(summaryOf(pane)).toHaveTextContent("It has arrived."));
      expect(within(pane).queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not there for a generated article", async () => {
    const { server, tools, generated } = seeded();
    renderApp({ server, route: `/c/${tools.slug}/${generated}` });
    const pane = await opened();
    await within(pane).findByRole("heading", { level: 2, name: "Generated" });
    expect(summaryOf(pane)).toBeNull();
    expect(within(pane).queryByRole("status")).toBeNull();
  });
});
