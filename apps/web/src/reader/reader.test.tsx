import { getArticle, insertArticle, insertFeed, markArticlesRead, setArticleFlags } from "@smarternews/core";
import { seedFeedArticle } from "@smarternews/core/testing";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeServer, renderApp, type TestServer } from "../testing/harness.tsx";

const MINUTE = 60_000;
const nav = () => screen.getByRole("navigation", { name: "項目" });
const list = () => screen.getByRole("region", { name: "記事の一覧" });
const article = () => screen.getByRole("article", { name: "記事" });
const rowTitles = () => within(list()).getAllByRole("listitem").map((item) => item.querySelector("[data-title]")?.textContent);
const row = (title: RegExp) => within(list()).getByRole("link", { name: title }).closest("li")!;

/** Adds articles one minute apart, so the last one is the newest. */
function articles(server: TestServer, categoryId: number, specs: Array<Parameters<TestServer["article"]>[1]>): number[] {
  return specs.map((spec) => {
    const id = server.article(categoryId, spec);
    server.clock.advance(MINUTE);
    return id;
  });
}

describe("the list that opens first", () => {
  it("shows the unread articles of every category, newest update first", async () => {
    const server = makeServer();
    const a = server.category("Security");
    const b = server.category("Tools");
    for (let index = 0; index < 20; index += 1) setArticleFlags(server.db, server.article(a.id), { isRead: true }, server.clock().toISOString());
    articles(server, a.id, [{ title: "One" }, { title: "Two" }]);
    articles(server, b.id, [{ title: "Three" }, { title: "Four" }, { title: "Five" }]);
    renderApp({ server });

    await screen.findByRole("link", { name: /Five/ });
    expect(rowTitles()).toEqual(["Five", "Four", "Three", "Two", "One"]);
    expect(screen.getByRole("heading", { level: 1, name: "未読" })).toBeInTheDocument();
  });

  it("says that nothing is unread and offers the full list", async () => {
    const server = makeServer();
    setArticleFlags(server.db, server.article(server.category().id, { title: "Read already" }), { isRead: true }, server.clock().toISOString());
    const { user } = renderApp({ server });

    expect(await screen.findByText("未読の記事はありません。")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "すべての記事を見る" }));
    expect(await screen.findByRole("link", { name: /Read already/ })).toBeInTheDocument();
  });

  it("says that there are no categories yet and points to the settings", async () => {
    renderApp();
    expect(await screen.findByText("カテゴリがまだありません。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定でカテゴリを追加する" })).toHaveAttribute("href", "/settings");
  });
});

describe("choosing a view", () => {
  function seeded() {
    const server = makeServer();
    const a = server.category("Security");
    const b = server.category("Tools");
    const [aUnread, aRead, aStarred] = articles(server, a.id, [{ title: "A unread" }, { title: "A read" }, { title: "A starred" }]);
    articles(server, b.id, [{ title: "B unread" }]);
    setArticleFlags(server.db, aRead!, { isRead: true }, server.clock().toISOString());
    setArticleFlags(server.db, aStarred!, { isRead: true, starred: true }, server.clock().toISOString());
    return { server, a, aUnread: aUnread! };
  }

  it("shows the unread articles of the category that is chosen", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server });

    await user.click(await within(nav()).findByRole("link", { name: /Security/ }));

    await screen.findByRole("heading", { level: 1, name: "Security" });
    await waitFor(() => expect(rowTitles()).toEqual(["A unread"]));
  });

  it("adds the read articles when asked to", async () => {
    const { server } = seeded();
    const { user, path } = renderApp({ server, route: "/c/security" });
    await screen.findByRole("link", { name: /A unread/ });

    await user.click(screen.getByRole("checkbox", { name: "既読も表示" }));

    await waitFor(() => expect(rowTitles()).toEqual(["A starred", "A read", "A unread"]));
    expect(path()).toBe("/c/security?read=1");
  });

  it("shows starred articles whether read or not", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server });

    await user.click(await within(nav()).findByRole("link", { name: /^スター/ }));

    await waitFor(() => expect(rowTitles()).toEqual(["A starred"]));
  });

  it("shows the same category and article again after a reload", async () => {
    const { server, aUnread } = seeded();
    renderApp({ server, route: `/c/security/${aUnread}` });

    expect(await screen.findByRole("heading", { level: 2, name: "A unread" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Security" })).toBeInTheDocument();
    expect(within(list()).getByRole("link", { name: /A unread/ })).toHaveAttribute("aria-current", "true");
  });
});

describe("a row of the list", () => {
  it("shows the headline, one line of summary, the category, the time and the number of sources", async () => {
    const server = makeServer("2026-03-01T09:30:00.000Z");
    const category = server.category("Security");
    server.article(category.id, {
      title: "Vendor ships fix",
      summary: "A patch is out.",
      refs: ["https://example.org/1", "https://example.net/2", "https://example.com/3"],
    });
    renderApp({ server });

    const item = (await screen.findByRole("link", { name: /Vendor ships fix/ })).closest("li")!;
    expect(item).toHaveTextContent("A patch is out.");
    expect(item).toHaveTextContent("Security");
    expect(item).toHaveTextContent("09:30");
    expect(item).toHaveTextContent("出典3件");
  });

  it("marks unread rows as unread and read rows as read", async () => {
    const server = makeServer();
    const category = server.category();
    const [read] = articles(server, category.id, [{ title: "Read one" }, { title: "Unread one" }]);
    setArticleFlags(server.db, read!, { isRead: true }, server.clock().toISOString());
    renderApp({ server, route: "/all" });

    await screen.findByRole("link", { name: /Unread one/ });
    expect(row(/Unread one/)).toHaveAttribute("data-read", "false");
    expect(row(/Read one/)).toHaveAttribute("data-read", "true");
  });

  it("marks importance four and five, and nothing below", async () => {
    const server = makeServer();
    const category = server.category();
    articles(server, category.id, [
      { title: "Routine", importance: 3 },
      { title: "Notable", importance: 4 },
      { title: "Urgent", importance: 5 },
    ]);
    renderApp({ server });

    await screen.findByRole("link", { name: /Urgent/ });
    expect(row(/Urgent/)).toHaveAttribute("data-importance", "5");
    expect(row(/Notable/)).toHaveAttribute("data-importance", "4");
    expect(row(/Routine/)).not.toHaveAttribute("data-importance");
  });

  it("puts the importance into the name of the row, for people who cannot see the mark", async () => {
    const server = makeServer();
    articles(server, server.category().id, [{ title: "Urgent", importance: 5 }, { title: "Routine", importance: 3 }]);
    renderApp({ server });

    expect(await screen.findByRole("link", { name: /重要度5.*Urgent/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Routine/ })).not.toHaveAccessibleName(/重要度/);
  });

  it("labels an updated article and an unconfirmed one", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "Rumour", unconfirmed: true });
    server.db.prepare("UPDATE articles SET revision = 1 WHERE id = ?").run(id);
    renderApp({ server });

    await screen.findByRole("link", { name: /Rumour/ });
    expect(row(/Rumour/)).toHaveTextContent("更新");
    expect(row(/Rumour/)).toHaveTextContent("未確認");
  });
});

describe("narrowing and paging", () => {
  it("shows only importance four and above when asked to", async () => {
    const server = makeServer();
    const category = server.category();
    articles(server, category.id, [
      ...Array.from({ length: 6 }, (_unused, index) => ({ title: `Routine ${index}`, importance: 3 })),
      { title: "Notable A", importance: 4 },
      { title: "Notable B", importance: 4 },
      { title: "Urgent", importance: 5 },
    ]);
    const { user, path } = renderApp({ server });
    await screen.findByRole("link", { name: /Urgent/ });

    await user.click(screen.getByRole("checkbox", { name: "重要度4以上だけ" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Urgent", "Notable B", "Notable A"]));
    expect(path()).toBe("/unread?min=4");
  });

  it("loads further articles until all 120 are shown once", async () => {
    const server = makeServer();
    const category = server.category();
    for (let index = 0; index < 120; index += 1) {
      server.article(category.id, { title: `Story ${index}` });
      if (index % 3 === 0) server.clock.advance(MINUTE);
    }
    const { user } = renderApp({ server });
    await screen.findByRole("link", { name: /Story 119/ });
    expect(rowTitles()).toHaveLength(50);

    await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
    await waitFor(() => expect(rowTitles()).toHaveLength(100));
    await user.click(screen.getByRole("button", { name: "さらに読み込む" }));
    await waitFor(() => expect(rowTitles()).toHaveLength(120));

    expect(new Set(rowTitles()).size).toBe(120);
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).not.toBeInTheDocument();
  });
});

describe("reading an article", () => {
  it("sets the article in one column of up to 52 characters, in the middle of its pane", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "Wide screen", impact: "What it means.", body: "Body text." });
    renderApp({ server, route: `/unread/${id}` });

    const article = await screen.findByRole("article", { name: "記事" });
    await within(article).findByRole("heading", { name: "Wide screen" });
    const column = article.firstElementChild!;
    // The limit is counted in characters of the body text, so the column carries the body's type.
    expect(column).toHaveClass("mx-auto", "w-full", "max-w-measure-article", "type-body-lg");
    // Nothing inside is held to the narrower limit that forms use: every block is as wide as the column.
    expect(column.querySelector(".max-w-measure")).toBeNull();
  });

  it("shows the headline, the category, the time, the importance, the body and every source", async () => {
    const server = makeServer("2026-03-01T09:30:00.000Z");
    const category = server.category("Security");
    const id = server.article(category.id, {
      title: "Vendor ships fix",
      body: "The vendor **shipped** a fix.\n\nAdministrators should update.",
      importance: 4,
      refs: ["https://example.org/advisory", "https://example.net/report"],
    });
    renderApp({ server, route: `/all/${id}` });

    await screen.findByRole("heading", { level: 2, name: "Vendor ships fix" });
    expect(article()).toHaveTextContent("Security");
    expect(article()).toHaveTextContent("2026年3月1日 09:30");
    expect(article()).toHaveTextContent("重要度 4");
    expect(within(article()).getByText("shipped").tagName).toBe("STRONG");
    expect(article()).toHaveTextContent("Administrators should update.");
    const sources = within(within(article()).getByRole("region", { name: "出典" })).getAllByRole("link");
    expect(sources.map((link) => link.getAttribute("href"))).toEqual(["https://example.org/advisory", "https://example.net/report"]);
    for (const link of sources) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    }
    expect(within(article()).getByRole("region", { name: "出典" })).toHaveTextContent("Example");
  });

  it("puts what the story means for the reader before the body", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "Flaw", impact: "Update this week.", body: "Body text here." });
    renderApp({ server, route: `/all/${id}` });

    const impact = await within(await screen.findByRole("article", { name: "記事" })).findByRole("region", { name: "読み手への影響" });
    expect(impact).toHaveTextContent("Update this week.");
    const body = within(article()).getByText("Body text here.");
    expect(impact.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("warns before the body that an article is unconfirmed", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "Rumour", unconfirmed: true, body: "Body text here." });
    renderApp({ server, route: `/all/${id}` });

    const note = await screen.findByText(/噂や非公式の情報に基づいています/);
    expect(note.compareDocumentPosition(within(article()).getByText("Body text here.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows markup inside the body as text and runs none of it", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, {
      title: "Hostile",
      body: 'Before <script>window.hacked = true</script> <img src=x onerror="window.hacked = true"> after.\n\n[click](javascript:window.hacked=true)',
    });
    renderApp({ server, route: `/all/${id}` });

    await screen.findByRole("heading", { level: 2, name: "Hostile" });
    await waitFor(() => expect(article()).toHaveTextContent("window.hacked = true"));
    expect(article().querySelector("script")).toBeNull();
    expect(article().querySelector("img")).toBeNull();
    expect(article().querySelector('a[href^="javascript"]')).toBeNull();
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
  });

  it("links back to the earlier article of the same story", async () => {
    const server = makeServer();
    const category = server.category();
    const earlier = server.article(category.id, { title: "Flaw disclosed" });
    server.clock.advance(7 * 24 * 60 * MINUTE);
    const later = insertArticle(server.db, {
      categoryId: category.id,
      kind: "news",
      title: "Lawsuit filed",
      summary: "s",
      body: "b",
      impact: null,
      importance: 3,
      unconfirmed: false,
      snippetOnly: false,
      event: null,
      now: server.clock().toISOString(),
      previousArticleId: earlier,
      refs: [],
      topicIds: [],
    });
    const { user } = renderApp({ server, route: `/all/${later}` });

    await user.click(await within(await screen.findByRole("article", { name: "記事" })).findByRole("link", { name: "Flaw disclosed" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Flaw disclosed" })).toBeInTheDocument();
  });

  it("says so when an article was written from snippets only", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "Thin", snippetOnly: true });
    renderApp({ server, route: `/all/${id}` });

    expect(await screen.findByText(/出典のページを読めなかったため、抜粋から書いています/)).toBeInTheDocument();
  });

  it("says that an article no longer exists", async () => {
    const server = makeServer();
    server.category();
    renderApp({ server, route: "/all/4242" });
    expect(await screen.findByText("この記事はありません。保存期間を過ぎて削除された可能性があります。")).toBeInTheDocument();
  });
});

describe("read state", () => {
  it("marks an article as read when it is opened and lowers the unread count", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const [first] = articles(server, category.id, [{ title: "First" }, { title: "Second" }]);
    const { user } = renderApp({ server });
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("2"));

    await user.click(screen.getByRole("link", { name: /First/ }));

    await waitFor(() => expect(getArticle(server.db, first!).isRead).toBe(true));
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("1"));
  });

  it("keeps an article that was just read in the unread list until the user moves on", async () => {
    const server = makeServer();
    const category = server.category();
    articles(server, category.id, [{ title: "First" }, { title: "Second" }]);
    const { user } = renderApp({ server });

    await user.click(await screen.findByRole("link", { name: /First/ }));
    await screen.findByRole("heading", { level: 2, name: "First" });
    await user.click(screen.getByRole("link", { name: /Second/ }));
    await screen.findByRole("heading", { level: 2, name: "Second" });

    expect(rowTitles()).toEqual(["Second", "First"]);
    await waitFor(() => expect(row(/First/)).toHaveAttribute("data-read", "true"));
    await user.click(screen.getByRole("link", { name: /First/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "First" })).toBeInTheDocument();
  });

  it("drops the articles that were read once the list is refreshed", async () => {
    const server = makeServer();
    articles(server, server.category().id, [{ title: "First" }, { title: "Second" }]);
    const { user } = renderApp({ server });

    await user.click(await screen.findByRole("link", { name: /First/ }));
    await waitFor(() => expect(row(/First/)).toHaveAttribute("data-read", "true"));
    await user.click(screen.getByRole("button", { name: "更新" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Second"]));
  });

  it("puts an article back to unread on request", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "Later" });
    const { user } = renderApp({ server, route: `/unread/${id}` });
    await waitFor(() => expect(getArticle(server.db, id).isRead).toBe(true));

    await user.click(await screen.findByRole("button", { name: "未読に戻す" }));

    await waitFor(() => expect(getArticle(server.db, id).isRead).toBe(false));
    await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("1"));
    expect(screen.getByRole("button", { name: "既読にする" })).toBeInTheDocument();
  });

  it("marks everything in the list as read, but not an article that arrived after the list was loaded", async () => {
    const server = makeServer();
    const category = server.category("Security");
    const listed = articles(server, category.id, [{ title: "Listed A" }, { title: "Listed B" }]);
    const { user } = renderApp({ server, route: "/c/security" });
    await screen.findByRole("link", { name: /Listed B/ });
    const late = server.article(category.id, { title: "Arrived late" });

    await user.click(screen.getByRole("button", { name: "すべて既読にする" }));

    await waitFor(() => expect(listed.map((id) => getArticle(server.db, id).isRead)).toEqual([true, true]));
    expect(getArticle(server.db, late).isRead).toBe(false);
    expect(await screen.findByRole("status")).toHaveTextContent("2件を既読にしました");
  });

  it("marks only what the importance filter shows", async () => {
    const server = makeServer();
    const category = server.category();
    const [low, high] = articles(server, category.id, [{ title: "Low", importance: 3 }, { title: "High", importance: 4 }]);
    const { user } = renderApp({ server, route: "/unread?min=4" });
    await screen.findByRole("link", { name: /High/ });

    await user.click(screen.getByRole("button", { name: "すべて既読にする" }));

    await waitFor(() => expect(getArticle(server.db, high!).isRead).toBe(true));
    expect(getArticle(server.db, low!).isRead).toBe(false);
  });

  it("undoes marking everything as read", async () => {
    const server = makeServer();
    const ids = articles(server, server.category().id, [{ title: "One" }, { title: "Two" }]);
    const { user } = renderApp({ server });
    await screen.findByRole("link", { name: /Two/ });
    await user.click(screen.getByRole("button", { name: "すべて既読にする" }));
    await waitFor(() => expect(getArticle(server.db, ids[0]!).isRead).toBe(true));

    await user.click(within(await screen.findByRole("status")).getByRole("button", { name: "取り消す" }));

    await waitFor(() => expect(ids.map((id) => getArticle(server.db, id).isRead)).toEqual([false, false]));
    await waitFor(() => expect(rowTitles()).toEqual(["Two", "One"]));
  });

  it("offers no bulk action where it would hide what the user came to see", async () => {
    const server = makeServer();
    setArticleFlags(server.db, server.article(server.category().id, { title: "Kept" }), { starred: true }, server.clock().toISOString());
    renderApp({ server, route: "/starred" });
    await screen.findByRole("link", { name: /Kept/ });
    expect(screen.queryByRole("button", { name: "すべて既読にする" })).not.toBeInTheDocument();
  });
});

describe("stars", () => {
  it("adds a star, shows it in the list and the article, and lists the article under starred", async () => {
    const server = makeServer();
    const id = server.article(server.category().id, { title: "Keep me" });
    const { user } = renderApp({ server, route: `/all/${id}` });

    await user.click(await screen.findByRole("button", { name: "スターを付ける" }));

    expect(await screen.findByRole("button", { name: "スターを外す" })).toBeInTheDocument();
    await waitFor(() => expect(row(/Keep me/)).toHaveTextContent("スター"));
    await waitFor(() => expect(getArticle(server.db, id).starred).toBe(true));
    await user.click(within(nav()).getByRole("link", { name: /^スター/ }));
    await waitFor(() => expect(rowTitles()).toEqual(["Keep me"]));
  });
});

describe("events", () => {
  function seeded() {
    const server = makeServer("2026-03-10T12:00:00.000Z");
    const category = server.category("Local events", "event");
    const event = (title: string, startsAt: string, endsAt: string, more: { venue?: string; fee?: string; registration?: "required" | "not_required" | "unknown" } = {}) =>
      server.article(category.id, {
        title,
        kind: "event",
        event: { key: title, startsAt, endsAt, venue: more.venue ?? null, fee: more.fee ?? null, registration: more.registration ?? "unknown" },
      });
    event("Finished fair", "2026-03-09T10:00:00.000Z", "2026-03-09T16:00:00.000Z");
    event("Later meetup", "2026-03-13T19:00:00.000Z", "2026-03-13T21:00:00.000Z");
    event("Morning class", "2026-03-11T10:00:00.000Z", "2026-03-11T12:00:00.000Z", { venue: "City Hall", registration: "required" });
    event("Evening talk", "2026-03-11T18:00:00.000Z", "2026-03-11T20:00:00.000Z", { venue: "Library", fee: "500円", registration: "not_required" });
    event("Week-long festival", "2026-03-08T00:00:00.000Z", "2026-03-12T23:59:59.999Z");
    return { server };
  }

  it("groups the events that have not ended by day, soonest first, with those under way on top", async () => {
    const { server } = seeded();
    renderApp({ server, route: "/c/local-events" });

    const events = await screen.findByRole("region", { name: "イベントの一覧" });
    await within(events).findByRole("link", { name: /Morning class/ });
    const groups = within(events).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(["開催中", "3月11日 水曜日", "3月13日 金曜日"]);
    expect(within(groups[1]!).getAllByRole("listitem").map((item) => item.querySelector("[data-title]")?.textContent)).toEqual([
      "Morning class",
      "Evening talk",
    ]);
    expect(within(events).queryByText("Finished fair")).not.toBeInTheDocument();
  });

  it("shows time, venue and registration on a row, and no fee when the fee is unknown", async () => {
    const { server } = seeded();
    renderApp({ server, route: "/c/local-events" });

    const morning = (await screen.findByRole("link", { name: /Morning class/ })).closest("li")!;
    expect(morning).toHaveTextContent("10:00 から 12:00");
    expect(morning).toHaveTextContent("City Hall");
    expect(morning).toHaveTextContent("要申込");
    expect(morning).not.toHaveTextContent("円");
    const evening = screen.getByRole("link", { name: /Evening talk/ }).closest("li")!;
    expect(evening).toHaveTextContent("500円");
    expect(evening).toHaveTextContent("申込不要");
  });

  it("opens an event like any article, with its date and venue above the body", async () => {
    const { server } = seeded();
    const { user } = renderApp({ server, route: "/c/local-events" });

    await user.click(await screen.findByRole("link", { name: /Morning class/ }));

    await screen.findByRole("heading", { level: 2, name: "Morning class" });
    expect(article()).toHaveTextContent("3月11日");
    expect(article()).toHaveTextContent("City Hall");
  });
});

describe("an article that other feeds delivered too", () => {
  /** Feed A keeps an article; feeds B and C delivered it too, recorded as its duplicates. */
  function duplicated() {
    const server = makeServer();
    const category = server.category("Tools");
    const feed = (title: string) => insertFeed(server.db, { url: `https://${title.toLowerCase().replace(/\W+/g, "-")}.example.org/feed.xml`, title, categoryId: category.id }, server.clock).id;
    const [a, b, c] = [feed("Feed A"), feed("Feed B"), feed("Feed C")];
    const kept = seedFeedArticle(server.db, a!, { title: "Kept story", url: "https://news.example.org/1", storedAt: "2026-03-01T01:00:00.000Z" });
    const copyB = seedFeedArticle(server.db, b!, { title: "Copy in B", storedAt: "2026-03-01T02:00:00.000Z", duplicateOf: kept });
    const copyC = seedFeedArticle(server.db, c!, { title: "Copy in C", storedAt: "2026-03-01T03:00:00.000Z", duplicateOf: kept });
    const alone = seedFeedArticle(server.db, a!, { title: "Alone", url: "https://news.example.org/2" });
    return { server, category, a, b, c, kept, copyB, copyC, alone };
  }

  it("is listed once in the unread list", async () => {
    const { server } = duplicated();
    renderApp({ server, route: "/unread" });
    await within(list()).findByRole("link", { name: /Kept story/ });
    expect(rowTitles()).toEqual(expect.arrayContaining(["Kept story", "Alone"]));
    expect(rowTitles()).toHaveLength(2);
  });

  it("is listed once in the list of its category", async () => {
    const { server, category } = duplicated();
    renderApp({ server, route: `/c/${category.slug}` });
    await within(list()).findByRole("link", { name: /Kept story/ });
    expect(rowTitles()).not.toContain("Copy in B");
    expect(rowTitles()).not.toContain("Copy in C");
  });

  it("names the other feeds under the way to its page", async () => {
    const { server, kept } = duplicated();
    renderApp({ server, route: `/all/${kept}` });
    const pane = await screen.findByRole("article", { name: "記事" });
    const others = await within(pane).findByRole("region", { name: "ほかに配信した購読フィード" });
    expect(within(others).getAllByRole("link").map((link) => link.textContent)).toEqual(["Feed B", "Feed C"]);
    const open = within(pane).getByRole("link", { name: "元のページを開く" });
    expect(open.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("names no other feed for an article that only one feed delivered", async () => {
    const { server, alone } = duplicated();
    renderApp({ server, route: `/all/${alone}` });
    const pane = await screen.findByRole("article", { name: "記事" });
    await within(pane).findByRole("heading", { level: 2, name: "Alone" });
    expect(within(pane).queryByRole("region", { name: "ほかに配信した購読フィード" })).toBeNull();
  });
});

describe("the recently read articles", () => {
  const at = (server: TestServer) => server.clock().toISOString();

  /** Article A of Security is opened at 09:00; at 10:00 mark all as read in Tools reads its three articles. */
  function readMistakenly() {
    const server = makeServer("2026-03-02T08:00:00.000Z");
    const security = server.category("Security");
    const tools = server.category("Tools");
    const a = server.article(security.id, { title: "Article A" });
    const [b1, b2, b3] = articles(server, tools.id, [{ title: "Tools 1" }, { title: "Tools 2" }, { title: "Tools 3" }]);
    server.clock.set("2026-03-02T09:00:00.000Z");
    setArticleFlags(server.db, a, { isRead: true }, at(server));
    server.clock.set("2026-03-02T10:00:00.000Z");
    markArticlesRead(server.db, { categoryId: tools.id, before: at(server) }, at(server));
    return { server, security, tools, a, ids: [b1!, b2!, b3!] };
  }

  it("lists what mark all as read read before the article opened earlier, and nothing read eight days ago", async () => {
    const { server } = readMistakenly();
    setArticleFlags(server.db, server.article(server.category("Old").id, { title: "Read long ago" }), { isRead: true }, "2026-02-22T10:00:00.000Z");
    const { user } = renderApp({ server });

    await user.click(await within(nav()).findByRole("link", { name: "最近読んだ記事" }));

    expect(await screen.findByRole("heading", { level: 1, name: "最近読んだ記事" })).toBeInTheDocument();
    await waitFor(() => expect(rowTitles()).toEqual(["Tools 3", "Tools 2", "Tools 1", "Article A"]));
  });

  it("offers neither mark all as read, nor the read toggle, nor the importance toggle", async () => {
    const { server } = readMistakenly();
    renderApp({ server, route: "/recently-read" });
    await within(list()).findByRole("link", { name: /Article A/ });

    expect(screen.queryByRole("button", { name: "すべて既読にする" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "既読も表示" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "重要度4以上だけ" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
  });

  it("says that nothing was read in the last seven days and opens the unread list", async () => {
    const server = makeServer();
    server.article(server.category().id, { title: "Still unread" });
    const { user, path } = renderApp({ server, route: "/recently-read" });

    expect(await screen.findByText("直近7日に読んだ記事はありません。")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "「未読」を開く" }));
    expect(path()).toBe("/unread");
    expect(await screen.findByRole("link", { name: /Still unread/ })).toBeInTheDocument();
  });

  it("shows on each row when it was read, for a generated and a feed article alike, and the update time elsewhere", async () => {
    const server = makeServer("2026-03-01T18:00:00.000Z");
    const category = server.category("Security");
    const generatedArticle = server.article(category.id, { title: "Generated story" });
    const feed = insertFeed(server.db, { url: "https://blog.example.org/feed.xml", title: "Blog", categoryId: category.id }, server.clock);
    const feedArticle = seedFeedArticle(server.db, feed.id, { title: "Feed post", at: "2026-03-01T18:00:00.000Z" });
    server.clock.set("2026-03-02T09:00:00.000Z");
    setArticleFlags(server.db, generatedArticle, { isRead: true }, at(server));
    server.clock.set("2026-03-02T09:15:00.000Z");
    setArticleFlags(server.db, feedArticle, { isRead: true }, at(server));
    const { user } = renderApp({ server, route: "/recently-read" });

    await within(list()).findByRole("link", { name: /Feed post/ });
    expect(row(/Generated story/)).toHaveTextContent("09:00");
    expect(row(/Feed post/)).toHaveTextContent("09:15");

    await user.click(within(nav()).getByRole("link", { name: /^すべて/ }));
    await waitFor(() => expect(row(/Generated story/)).toHaveTextContent("昨日"));
  });

  it("keeps a row put back to unread where it was, as unread, through the refresh every minute, until 更新", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { server, ids } = readMistakenly();
      const { user } = renderApp({ server, route: "/recently-read" });
      await within(list()).findByRole("link", { name: /Tools 2/ });
      await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).not.toHaveTextContent(/\d/));

      await user.click(row(/Tools 2/).querySelector("a")!);
      await user.click(await screen.findByRole("button", { name: "未読に戻す" }));

      await waitFor(() => expect(getArticle(server.db, ids[1]!).isRead).toBe(false));
      await waitFor(() => expect(within(nav()).getByRole("link", { name: /^未読/ })).toHaveTextContent("1"));
      await waitFor(() => expect(row(/Tools 2/)).toHaveAttribute("data-read", "false"));
      expect(rowTitles()).toEqual(["Tools 3", "Tools 2", "Tools 1", "Article A"]);
      expect(row(/Tools 2/)).toHaveTextContent("10:00");

      await vi.advanceTimersByTimeAsync(61_000);
      await waitFor(() => expect(rowTitles()).toEqual(["Tools 3", "Tools 2", "Tools 1", "Article A"]));
      expect(row(/Tools 2/)).toHaveAttribute("data-read", "false");

      await user.click(screen.getByRole("button", { name: "更新" }));
      await waitFor(() => expect(rowTitles()).toEqual(["Tools 3", "Tools 1", "Article A"]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a row put back to unread once another list is chosen", async () => {
    const { server, a } = readMistakenly();
    const { user } = renderApp({ server, route: `/recently-read/${a}` });
    await user.click(await screen.findByRole("button", { name: "未読に戻す" }));
    await waitFor(() => expect(row(/Article A/)).toHaveAttribute("data-read", "false"));

    await user.click(within(nav()).getByRole("link", { name: /^スター/ }));
    await screen.findByRole("heading", { level: 1, name: "スター" });
    await user.click(within(nav()).getByRole("link", { name: "最近読んだ記事" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Tools 3", "Tools 2", "Tools 1"]));
  });

  it("shows the list and the open article again after a reload", async () => {
    const { server, a } = readMistakenly();
    renderApp({ server, route: `/recently-read/${a}` });

    expect(await screen.findByRole("heading", { level: 2, name: "Article A" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "最近読んだ記事" })).toBeInTheDocument();
    await waitFor(() => expect(within(list()).getByRole("link", { name: /Article A/ })).toHaveAttribute("aria-current", "true"));
    expect(getArticle(server.db, a).readAt).toBe("2026-03-02T09:00:00.000Z");
  });
});
