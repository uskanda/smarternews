import { act, fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { renderApp } from "../testing/app";
import { eventually, MINUTE, rowTitles } from "../testing/queries";
import { makeServer, type ArticleOverrides, type TestServer } from "../testing/server";

async function articles(server: TestServer, categoryId: number, list: ArticleOverrides[]): Promise<number[]> {
  const ids: number[] = [];
  for (const overrides of list) {
    ids.push(await server.article(categoryId, overrides));
    await server.advance(MINUTE);
  }
  return ids;
}

const WIDTH = 750; // the window of the test device
const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const isRead = async (server: TestServer, id: number) => (await server.core<{ isRead: boolean }>("getArticle", id)).isRead;

/** Moves the pager to the page with this index, as a finger swipe that has come to rest does. */
async function swipeTo(index: number, pages: number) {
  const pager = screen.getByTestId("article-pager");
  const nativeEvent = { contentOffset: { x: WIDTH * index, y: 0 }, contentSize: { width: WIDTH * pages, height: 1334 }, layoutMeasurement: { width: WIDTH, height: 1334 } };
  await fireEvent.scroll(pager, { nativeEvent });
  await fireEvent(pager, "momentumScrollEnd", { nativeEvent });
}

describe("reading an article", () => {
  it("shows the headline, what it means for the reader, the body and every source", async () => {
    const server = await makeServer();
    const category = await server.category("Security");
    await server.article(category.id, {
      title: "Two sources",
      impact: "Patch the gateway this week.",
      body: "First paragraph.\n\nSecond paragraph with **emphasis**.",
      importance: 4,
      refs: ["https://example.org/a", "https://example.com/b"],
    });
    await renderApp({ server });

    await press(/Two sources/);

    expect(await screen.findByRole("header", { name: "Two sources" })).toBeOnTheScreen();
    expect(screen.getByText("読み手への影響")).toBeOnTheScreen();
    expect(screen.getByText("Patch the gateway this week.")).toBeOnTheScreen();
    expect(screen.getByText("First paragraph.")).toBeOnTheScreen();
    expect(screen.getByText("emphasis")).toBeOnTheScreen();
    expect(screen.getAllByRole("link", { name: /Example/ })).toHaveLength(2);
    expect(screen.getByLabelText("Security、2026年3月1日 12:00 に更新、重要度 4")).toBeOnTheScreen();
  });

  it("says so when an article was written from snippets only", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "Thin", snippetOnly: true });
    await renderApp({ server });

    await press(/Thin/);

    expect(await screen.findByText("出典のページを読めなかったため、抜粋から書いています。")).toBeOnTheScreen();
  });

  it("warns before the body that an article is unconfirmed", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "Rumour", unconfirmed: true });
    await renderApp({ server });

    await press(/Rumour/);

    expect(await screen.findByText("噂や非公式の情報に基づいています。")).toBeOnTheScreen();
  });

  it("shows markup inside the body as text and runs none of it", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, {
      title: "Markup",
      body: 'Before.\n\n<script>globalThis.__ran = true</script>\n\nInline <img src=x onerror="globalThis.__ran = true"> tag.',
    });
    await renderApp({ server });

    await press(/Markup/);

    expect(await screen.findByText("<script>globalThis.__ran = true</script>")).toBeOnTheScreen();
    expect(screen.getByText(/<img src=x onerror=/)).toBeOnTheScreen();
    expect((globalThis as { __ran?: boolean }).__ran).toBeUndefined();
  });

  it("opens the earlier article of the same story from a follow-up", async () => {
    const server = await makeServer();
    const category = await server.category();
    const first = await server.article(category.id, { title: "First report" });
    await server.core("setArticleFlags", first, { isRead: true });
    await server.advance(7 * 24 * 60 * MINUTE);
    const later = await server.article(category.id, { title: "Follow-up" });
    await server.sql("UPDATE articles SET previous_article_id = ? WHERE id = ?", first, later);
    await renderApp({ server });

    await press(/Follow-up/);
    await userEvent.setup().press(await screen.findByRole("link", { name: "First report" }));

    expect(await screen.findByRole("header", { name: "First report" })).toBeOnTheScreen();
  });

  it("says that an article no longer exists", async () => {
    const server = await makeServer();
    await renderApp({ server, url: "/article/999?list=unread" });

    expect(await screen.findByText(/この記事はありません/)).toBeOnTheScreen();
  });

  it("leads back to the unread list from an article that was opened directly, as from a notification", async () => {
    const server = await makeServer();
    const [, second] = await articles(server, (await server.category()).id, [{ title: "Other" }, { title: "Notified" }]);
    await renderApp({ server, url: `/article/${second}` });
    await screen.findByRole("header", { name: "Notified" });

    await press("一覧へ戻る");

    expect(await screen.findByRole("header", { name: "未読" })).toBeOnTheScreen();
    await waitFor(() => expect(rowTitles()).toEqual(["Notified", "Other"]));
  });

  it("gives the three actions a name and a size of at least 48dp", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "A story" });
    await renderApp({ server });
    await press(/A story/);
    await screen.findByRole("header", { name: "A story" });

    for (const name of ["スターを付ける", "未読に戻す", "出典を開く"]) {
      const style = screen.getByRole("button", { name }).props.style as { width: number; height: number };
      expect(style.width).toBeGreaterThanOrEqual(48);
      expect(style.height).toBeGreaterThanOrEqual(48);
    }
  });
});

describe("read state", () => {
  it("marks an article as read when it is opened and lowers the unread count", async () => {
    const server = await makeServer();
    const [first] = await articles(server, (await server.category()).id, [{ title: "First" }, { title: "Second" }]);
    await renderApp({ server });

    await press(/First/);
    await screen.findByRole("header", { name: "First" });

    await eventually(async () => expect(await isRead(server, first!)).toBe(true));
    await press("一覧へ戻る");
    await press("項目を開く");
    expect(await screen.findByRole("button", { name: "未読、未読1件" })).toBeOnTheScreen();
  });

  it("keeps an article that was just read in the unread list, shown as read, until the list is refreshed", async () => {
    const server = await makeServer();
    await articles(server, (await server.category()).id, [{ title: "First" }, { title: "Second" }]);
    await renderApp({ server });

    await press(/First/);
    await screen.findByRole("header", { name: "First" });
    await press("一覧へ戻る");

    await waitFor(() => expect(rowTitles()).toEqual(["Second", "First"]));
    await waitFor(() => expect(screen.getByRole("button", { name: /First/ }).props.accessibilityLabel).toMatch(/既読$/));
    expect(screen.getByRole("button", { name: /Second/ }).props.accessibilityLabel).toMatch(/未読$/);

    const { refreshControl } = screen.getByTestId("article-list").props as { refreshControl: { props: { onRefresh: () => void } } };
    await act(async () => refreshControl.props.onRefresh());
    await waitFor(() => expect(rowTitles()).toEqual(["Second"]));
  });

  it("puts an article back to unread on request, and leaves the unread count as it was", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Later" });
    await renderApp({ server });

    await press(/Later/);
    await eventually(async () => expect(await isRead(server, id)).toBe(true));
    await press("未読に戻す");

    await eventually(async () => expect(await isRead(server, id)).toBe(false));
    expect(await screen.findByRole("button", { name: "既読にする" })).toBeOnTheScreen();
    await press("一覧へ戻る");
    await waitFor(() => expect(screen.getByRole("button", { name: /Later/ }).props.accessibilityLabel).toMatch(/未読$/));
  });
});

describe("stars", () => {
  it("adds a star and takes it away again, naming the button by what it will do", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "Keep" });
    await renderApp({ server });
    await press(/Keep/);
    await screen.findByRole("header", { name: "Keep" });

    await press("スターを付ける");
    await eventually(async () => expect((await server.core<{ starred: boolean }>("getArticle", id)).starred).toBe(true));
    await press("スターを外す");

    await eventually(async () => expect((await server.core<{ starred: boolean }>("getArticle", id)).starred).toBe(false));
    expect(await screen.findByRole("button", { name: "スターを付ける" })).toBeOnTheScreen();
  });
});

describe("swiping between articles", () => {
  it("shows the next article of the list after a swipe to the left, and marks it as read", async () => {
    const server = await makeServer();
    const [third, second] = await articles(server, (await server.category()).id, [{ title: "Third" }, { title: "Second" }, { title: "First" }]);
    await renderApp({ server });
    await waitFor(() => expect(rowTitles()).toEqual(["First", "Second", "Third"]));

    await press(/Second/);
    await screen.findByRole("header", { name: "Second" });
    await swipeTo(2, 3);

    expect(await screen.findByRole("header", { name: "Third" })).toBeOnTheScreen();
    await eventually(async () => expect(await isRead(server, third!)).toBe(true));
    expect(await isRead(server, second!)).toBe(true);
    expect(screen.getByLabelText("3件のうち3件目")).toBeOnTheScreen();
  });

  it("moves to the next and the previous article without a swipe, as an action for a screen reader", async () => {
    const server = await makeServer();
    await articles(server, (await server.category()).id, [{ title: "Second" }, { title: "First" }]);
    await renderApp({ server });
    await press(/First/);
    await screen.findByRole("header", { name: "First" });
    const pager = screen.getByTestId("article-pager");
    expect(pager.props.accessibilityActions).toEqual([
      { name: "next", label: "次の記事" },
      { name: "previous", label: "前の記事" },
    ]);

    await fireEvent(pager, "accessibilityAction", { nativeEvent: { actionName: "next" } });
    expect(await screen.findByRole("header", { name: "Second" })).toBeOnTheScreen();
    expect(screen.getByLabelText("2件のうち2件目")).toBeOnTheScreen();

    await fireEvent(screen.getByTestId("article-pager"), "accessibilityAction", { nativeEvent: { actionName: "previous" } });
    expect(await screen.findByLabelText("2件のうち1件目")).toBeOnTheScreen();
  });

  it("follows a scroll that ends without a fling", async () => {
    const server = await makeServer();
    await articles(server, (await server.category()).id, [{ title: "Second" }, { title: "First" }]);
    await renderApp({ server });
    await press(/First/);
    await screen.findByRole("header", { name: "First" });

    const nativeEvent = { contentOffset: { x: WIDTH, y: 0 }, contentSize: { width: WIDTH * 2, height: 1334 }, layoutMeasurement: { width: WIDTH, height: 1334 } };
    await fireEvent(screen.getByTestId("article-pager"), "scrollEndDrag", { nativeEvent });

    expect(await screen.findByLabelText("2件のうち2件目")).toBeOnTheScreen();
  });

  it("stays on the last article when it is swiped to the left", async () => {
    const server = await makeServer();
    await articles(server, (await server.category()).id, [{ title: "Last" }, { title: "First" }]);
    await renderApp({ server });

    await press(/Last/);
    await screen.findByRole("header", { name: "Last" });
    await swipeTo(1, 2);

    expect(screen.getByRole("header", { name: "Last" })).toBeOnTheScreen();
    expect(screen.getByLabelText("2件のうち2件目")).toBeOnTheScreen();
  });

  it("keeps the pages in the order the list had when the article was opened", async () => {
    const server = await makeServer();
    const category = await server.category();
    await articles(server, category.id, [{ title: "B" }, { title: "A" }]);
    await renderApp({ server });
    await press(/^A。/);
    await screen.findByRole("header", { name: "A" });

    await server.article(category.id, { title: "Arrived later" });
    await swipeTo(1, 2);

    expect(await screen.findByRole("header", { name: "B" })).toBeOnTheScreen();
    expect(screen.getByLabelText("2件のうち2件目")).toBeOnTheScreen();
  });
});

describe("sources and links", () => {
  beforeEach(() => (WebBrowser.openBrowserAsync as jest.Mock).mockClear());

  it("opens a source in the in-app browser", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "Sourced", refs: ["https://example.org/report"] });
    await renderApp({ server });
    await press(/Sourced/);

    await userEvent.setup().press(await screen.findByRole("link", { name: /Example/ }));

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://example.org/report");
    expect(screen.getByRole("header", { name: "Sourced" })).toBeOnTheScreen();
  });

  it("opens the first source from the button at the bottom", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "Sourced", refs: ["https://example.org/report"] });
    await renderApp({ server });
    await press(/Sourced/);
    await screen.findByRole("header", { name: "Sourced" });

    await press("出典を開く");

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://example.org/report");
  });

  it("opens a web link in the body, and nothing for a link with another scheme", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, {
      title: "Links",
      body: "See [the advisory](https://example.org/advisory) and [this](javascript:alert(1)) and [that](file:///etc/passwd).",
    });
    await renderApp({ server });
    await press(/Links/);

    await userEvent.setup().press(await screen.findByRole("link", { name: "the advisory" }));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://example.org/advisory");

    expect(screen.queryByRole("link", { name: "this" })).toBeNull();
    expect(screen.queryByRole("link", { name: "that" })).toBeNull();
    await userEvent.setup().press(screen.getByText(/this/));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledTimes(1);
  });
});
