import { fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderApp } from "../testing/app";
import { listData, MINUTE, rowTitles } from "../testing/queries";
import { makeServer, type ArticleOverrides, type TestServer } from "../testing/server";

/** Stores articles one minute apart, so that their order in a list is known. Returns their ids. */
async function articles(server: TestServer, categoryId: number, list: ArticleOverrides[]): Promise<number[]> {
  const ids: number[] = [];
  for (const overrides of list) {
    ids.push(await server.article(categoryId, overrides));
    await server.advance(MINUTE);
  }
  return ids;
}

const row = (name: RegExp) => screen.getByRole("button", { name });
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(5).filter(Boolean)) as Record<string, unknown>;

describe("the list that opens first", () => {
  it("shows the unread articles of every category, newest update first", async () => {
    const server = await makeServer();
    const a = await server.category("A");
    const b = await server.category("B");
    await articles(server, a.id, [{ title: "Oldest" }, { title: "Middle" }]);
    await articles(server, b.id, [{ title: "Newest" }]);
    for (let index = 0; index < 20; index += 1) await server.core("setArticleFlags", await server.article(a.id), { isRead: true }, "$now");
    await renderApp({ server });

    await waitFor(() => expect(rowTitles()).toEqual(["Newest", "Middle", "Oldest"]));
    expect(screen.getByRole("header", { name: "未読" })).toBeOnTheScreen();
  });

  it("says that nothing is unread", async () => {
    const server = await makeServer();
    await server.core("setArticleFlags", await server.article((await server.category()).id, { title: "Read already" }), { isRead: true }, "$now");
    await renderApp({ server });

    expect(await screen.findByText("未読の記事はありません。")).toBeOnTheScreen();
    expect(screen.queryByText("Read already")).toBeNull();
  });
});

describe("choosing a view", () => {
  async function setup() {
    const server = await makeServer();
    const a = await server.category("Category A");
    const b = await server.category("Category B");
    const [aUnread, aRead, aStarred] = await articles(server, a.id, [{ title: "A unread" }, { title: "A read" }, { title: "A starred" }]);
    await articles(server, b.id, [{ title: "B unread" }]);
    await server.core("setArticleFlags", aRead, { isRead: true }, "$now");
    await server.core("setArticleFlags", aStarred, { isRead: true, starred: true }, "$now");
    return { server, aUnread };
  }

  it("shows the unread articles of the category that is chosen", async () => {
    const { server } = await setup();
    await renderApp({ server, url: "/list/category-1" });

    await waitFor(() => expect(rowTitles()).toEqual(["A unread"]));
  });

  it("adds the read articles when asked to", async () => {
    const { server } = await setup();
    await renderApp({ server, url: "/list/category-1" });
    await screen.findByText("A unread");

    await userEvent.setup().press(screen.getByRole("switch", { name: "既読も表示" }));

    await waitFor(() => expect(rowTitles()).toEqual(["A starred", "A read", "A unread"]));
  });

  it("shows starred articles whether read or not", async () => {
    const { server, aUnread } = await setup();
    await server.core("setArticleFlags", aUnread, { starred: true }, "$now");
    await renderApp({ server, url: "/list/starred" });

    await waitFor(() => expect(rowTitles()).toEqual(["A starred", "A unread"]));
  });

  it("says so when the category does not exist", async () => {
    const { server } = await setup();
    await renderApp({ server, url: "/list/category-999" });

    expect(await screen.findByText("このカテゴリはありません。")).toBeOnTheScreen();
  });
});

describe("a row of the list", () => {
  it("shows the headline, the summary in at most two lines, the category, the time and the number of sources", async () => {
    const server = await makeServer("2026-03-01T12:00:00.000Z");
    const category = await server.category("Security");
    await server.article(category.id, {
      title: "Three sources",
      summary: "What happened, in a sentence.",
      refs: ["https://example.org/1", "https://example.com/2", "https://example.net/3"],
    });
    await renderApp({ server });

    await screen.findByText("Three sources");
    const summary = screen.getByText("What happened, in a sentence.");
    expect(summary.props.numberOfLines).toBe(2);
    expect(row(/Three sources/).props.accessibilityLabel).toBe("Three sources。What happened, in a sentence。Security。12:00。出典3件。未読");
  });

  it("draws an unread headline heavier and darker than a read one", async () => {
    const server = await makeServer();
    const category = await server.category();
    const [read] = await articles(server, category.id, [{ title: "Read one" }, { title: "Unread one" }]);
    await server.core("setArticleFlags", read, { isRead: true }, "$now");
    await renderApp({ server, url: "/list/all" });

    const unreadStyle = flat((await screen.findByText("Unread one")).props.style);
    const readStyle = flat(screen.getByText("Read one").props.style);
    expect(unreadStyle.fontFamily).toBe("IBMPlexSansJP_600SemiBold");
    expect(readStyle.fontFamily).toBe("IBMPlexSansJP_400Regular");
    expect(unreadStyle.color).not.toBe(readStyle.color);
    expect(row(/Read one/).props.accessibilityLabel).toMatch(/既読$/);
  });

  it("keeps a headline at the same height when it is read, so that the rows below do not move", async () => {
    const server = await makeServer();
    const [read] = await articles(server, (await server.category()).id, [{ title: "Read one" }, { title: "Unread one" }]);
    await server.core("setArticleFlags", read, { isRead: true }, "$now");
    await renderApp({ server, url: "/list/all" });

    const unreadStyle = flat((await screen.findByText("Unread one")).props.style);
    const readStyle = flat(screen.getByText("Read one").props.style);
    expect(readStyle.lineHeight).toBe(unreadStyle.lineHeight);
    expect(readStyle.fontSize).toBe(unreadStyle.fontSize);
  });

  it("keeps the full text colour on a read headline that carries the importance-five mark", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Urgent and read", importance: 5 });
    await server.core("setArticleFlags", id, { isRead: true }, "$now");
    await renderApp({ server, url: "/list/all" });

    const style = flat((await screen.findByText("Urgent and read")).props.style);
    // Muted text on the mark's fill is too faint in the dark scheme.
    expect(style.color).toBe("#17202B");
    expect(style.fontFamily).toBe("IBMPlexSansJP_400Regular");
  });

  it("marks importance four and five with a stroke, five also on the headline, and nothing below", async () => {
    const server = await makeServer();
    const [routine, notable, urgent] = await articles(server, (await server.category()).id, [
      { title: "Routine", importance: 3 },
      { title: "Notable", importance: 4 },
      { title: "Urgent", importance: 5 },
    ]);
    await renderApp({ server });
    await screen.findByText("Urgent");

    expect(screen.queryByTestId(`mark-${routine}`)).toBeNull();
    expect(screen.getByTestId(`mark-${notable}`)).toBeOnTheScreen();
    expect(screen.getByTestId(`mark-${urgent}`)).toBeOnTheScreen();
    expect(flat(screen.getByText("Urgent").props.style).backgroundColor).toBe("#FFE98A");
    expect(flat(screen.getByText("Notable").props.style).backgroundColor).toBeUndefined();
  });

  it("puts the importance into the name of the row, for people who cannot see the mark", async () => {
    const server = await makeServer();
    await articles(server, (await server.category()).id, [{ title: "Urgent", importance: 5 }, { title: "Routine", importance: 3 }]);
    await renderApp({ server });

    expect(await screen.findByRole("button", { name: /^重要度5。Urgent/ })).toBeOnTheScreen();
    expect(row(/Routine/).props.accessibilityLabel).not.toMatch(/重要度/);
  });

  it("labels an updated article and an unconfirmed one in words", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Rumour", unconfirmed: true });
    await server.sql("UPDATE articles SET revision = 1 WHERE id = ?", id);
    await renderApp({ server });

    await screen.findByText("Rumour");
    expect(screen.getByText("更新")).toBeOnTheScreen();
    expect(screen.getByText("未確認")).toBeOnTheScreen();
    expect(row(/Rumour/).props.accessibilityLabel).toMatch(/更新。未確認/);
  });
});

describe("narrowing and paging", () => {
  it("shows only importance four and above when asked to", async () => {
    const server = await makeServer();
    await articles(server, (await server.category()).id, [{ title: "Routine", importance: 3 }, { title: "Notable", importance: 4 }, { title: "Urgent", importance: 5 }]);
    await renderApp({ server });
    await screen.findByText("Routine");

    await userEvent.setup().press(screen.getByRole("switch", { name: "重要度4以上だけ" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Urgent", "Notable"]));
    expect(screen.getByRole("switch", { name: "重要度4以上だけ" })).toBeChecked();
  });

  it("loads further articles as the end of the list is reached, until all 120 are held once", async () => {
    const server = await makeServer();
    const category = await server.category();
    for (let index = 0; index < 120; index += 1) {
      await server.article(category.id, { title: `Story ${index}` });
      if (index % 3 === 0) await server.advance(MINUTE);
    }
    await renderApp({ server, url: "/list/all" });
    await screen.findByText("Story 119");
    expect(listData()).toHaveLength(50);

    await fireEvent(screen.getByTestId("article-list"), "endReached");
    await waitFor(() => expect(listData()).toHaveLength(100));
    await fireEvent(screen.getByTestId("article-list"), "endReached");
    await waitFor(() => expect(listData()).toHaveLength(120));
    await fireEvent(screen.getByTestId("article-list"), "endReached");

    const ids = listData().map((item) => item.id);
    expect(new Set(ids).size).toBe(120);
  }, 60_000);
});

describe("the recently read articles", () => {
  /** Article A is opened at 09:00; at 10:00 mark all as read in Tools reads its three articles. */
  async function readMistakenly() {
    const server = await makeServer("2026-03-02T08:00:00.000Z");
    const security = await server.category("Security");
    const tools = await server.category("Tools");
    const a = await server.article(security.id, { title: "Article A" });
    const ids = await articles(server, tools.id, [{ title: "Tools 1" }, { title: "Tools 2" }, { title: "Tools 3" }]);
    await server.advance(57 * MINUTE);
    await server.core("setArticleFlags", a, { isRead: true }, "$now");
    await server.advance(60 * MINUTE);
    await server.core("markArticlesRead", { categoryId: tools.id, before: server.now().toISOString() }, "$now");
    return { server, a, ids };
  }

  it("lists what mark all as read read before the article opened earlier, and nothing read eight days ago", async () => {
    const { server } = await readMistakenly();
    await server.core("setArticleFlags", await server.article((await server.category("Old")).id, { title: "Read long ago" }), { isRead: true }, "2026-02-22T10:00:00.000Z");
    await renderApp({ server });
    await screen.findByRole("header", { name: "未読" });

    await userEvent.setup().press(await screen.findByRole("button", { name: "項目を開く" }));
    await userEvent.setup().press(await screen.findByRole("button", { name: "最近読んだ記事" }));

    expect(await screen.findByRole("header", { name: "最近読んだ記事" })).toBeOnTheScreen();
    await waitFor(() => expect(rowTitles()).toEqual(["Tools 3", "Tools 2", "Tools 1", "Article A"]));
  });

  it("offers neither mark all as read, nor the read toggle, nor the importance toggle", async () => {
    const { server } = await readMistakenly();
    await renderApp({ server, url: "/list/recently-read" });
    await screen.findByText("Article A");

    expect(screen.queryByRole("button", { name: "すべて既読にする" })).toBeNull();
    expect(screen.queryByText("既読も表示")).toBeNull();
    expect(screen.queryByText("重要度4以上だけ")).toBeNull();
  });

  it("says that nothing was read in the last seven days and opens the unread list", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "Still unread" });
    await renderApp({ server, url: "/list/recently-read" });

    expect(await screen.findByText("直近7日に読んだ記事はありません。")).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("button", { name: "「未読」を開く" }));
    expect(await screen.findByRole("header", { name: "未読" })).toBeOnTheScreen();
    expect(await screen.findByText("Still unread")).toBeOnTheScreen();
  });

  it("shows on each row when it was read, for a generated and a feed article alike, and the update time elsewhere", async () => {
    const server = await makeServer("2026-03-01T18:00:00.000Z");
    const category = await server.category("Security");
    const generated = await server.article(category.id, { title: "Generated story" });
    const blog = await server.feed("Blog", category.id);
    const post = await server.feedArticle(blog.id, { title: "Feed post", at: "2026-03-01T18:00:00.000Z" });
    await server.advance(15 * 60 * MINUTE);
    await server.core("setArticleFlags", generated, { isRead: true }, "$now");
    await server.advance(15 * MINUTE);
    await server.core("setArticleFlags", post, { isRead: true }, "$now");
    await renderApp({ server, url: "/list/recently-read" });

    await screen.findByText("Feed post");
    expect(row(/Generated story/).props.accessibilityLabel).toContain("。09:00。");
    expect(row(/Feed post/).props.accessibilityLabel).toContain("。09:15。");

    await userEvent.setup().press(screen.getByRole("button", { name: "項目を開く" }));
    await userEvent.setup().press(await screen.findByRole("button", { name: "すべて" }));
    await screen.findByRole("header", { name: "すべて" });
    await waitFor(() => expect(row(/Generated story/).props.accessibilityLabel).toContain("。昨日。"));
  });
});
