import { fireEvent, screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { renderApp } from "../testing/app";
import { eventually, MINUTE } from "../testing/queries";
import { makeServer, type TestServer } from "../testing/server";

const WIDTH = 750; // the window of the test device
const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const isRead = async (server: TestServer, id: number) => (await server.core<{ isRead: boolean }>("getArticle", id)).isRead;

/** The text a node draws, nested texts included. */
interface Drawn {
  children: ReadonlyArray<Drawn | string>;
}
function textOf(node: Drawn | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
const titles = () => screen.getAllByTestId(/^title-\d+$/).map(textOf);
const matchesIn = (node: Parameters<typeof within>[0]) => within(node).queryAllByTestId("search-match").map(textOf);

async function openDrawer() {
  await press("項目を開く");
}

async function searchFor(words: string) {
  await openDrawer();
  const box = await screen.findByLabelText("記事を検索");
  await fireEvent.changeText(box, words);
  await fireEvent(box, "submitEditing");
}

/** Two categories with articles about batteries, one of them read, and a feed in category A. */
async function seeded() {
  const server = await makeServer();
  const a = await server.category("Alpha");
  const b = await server.category("Beta");
  const ids: Record<string, number> = {};
  ids.aOld = await server.article(a.id, { title: "電池の古い話", summary: "要約" });
  await server.advance(MINUTE);
  ids.bRead = await server.article(b.id, { title: "電池の既読の話", summary: "要約" });
  await server.core("setArticleFlags", ids.bRead, { isRead: true }, "$now");
  await server.advance(MINUTE);
  const feed = await server.feed("Battery Feed", a.id);
  ids.feed = await server.feedArticle(feed.id, { title: "News of the day", body: `${"前置き。".repeat(30)}新しい電池の工場ができた。`, at: server.now().toISOString() });
  await server.advance(MINUTE);
  ids.other = await server.article(b.id, { title: "関係のない話", summary: "要約" });
  return { server, a, b, feed, ids };
}

describe("the search box of the drawer", () => {
  it("sits above 未読, and is named for a screen reader", async () => {
    const { server } = await seeded();
    await renderApp({ server });
    await openDrawer();
    const box = await screen.findByLabelText("記事を検索");
    expect(box.props.returnKeyType).toBe("search");
    // Found in the order they are drawn, top to bottom.
    const both = screen.getAllByLabelText(/^(記事を検索|未読、未読3件)$/);
    expect(both.map((node) => node.props.accessibilityLabel)).toEqual(["記事を検索", "未読、未読3件"]);
  });

  it("closes the drawer and shows the results over every article, read ones included, from any list", async () => {
    const { server } = await seeded();
    const view = await renderApp({ server, url: "/list/category-1" });
    await searchFor("電池");

    expect(await screen.findByRole("header", { name: "「電池」の検索結果" })).toBeOnTheScreen();
    await waitFor(() => expect(titles()).toEqual(["News of the day", "電池の既読の話", "電池の古い話"]));
    expect(view.pathname()).toMatch(/^\/search\?/);
  });

  it("changes nothing with spaces only", async () => {
    const { server } = await seeded();
    const view = await renderApp({ server, url: "/list/all" });
    await searchFor("   ");
    expect(view.pathname()).toBe("/list/all");
    expect(screen.queryByRole("header", { name: /検索結果/ })).toBeNull();
  });
});

describe("the search results", () => {
  it("narrow to unread articles when asked, and offer no marking of everything", async () => {
    const { server, ids } = await seeded();
    await renderApp({ server, url: `/search?q=${encodeURIComponent("電池")}` });
    await waitFor(() => expect(titles()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: "すべて既読にする" })).toBeNull();

    await userEvent.setup().press(screen.getByRole("switch", { name: "未読だけ" }));

    await waitFor(() => expect(titles()).toEqual(["News of the day", "電池の古い話"]));
    expect(await isRead(server, ids.aOld!)).toBe(false);
  });

  it("narrow to a category and to a feed", async () => {
    const { server } = await seeded();
    await renderApp({ server, url: `/search?q=${encodeURIComponent("電池")}` });
    await waitFor(() => expect(titles()).toHaveLength(3));

    await press("絞り込み：すべて");
    await press("Alpha");
    await waitFor(() => expect(titles()).toEqual(["News of the day", "電池の古い話"]));

    await press("絞り込み：Alpha");
    await press("Battery Feed");
    await waitFor(() => expect(titles()).toEqual(["News of the day"]));
  });

  it("show an excerpt in place of the summary, and mark the matches", async () => {
    const { server, ids } = await seeded();
    await renderApp({ server, url: `/search?q=${encodeURIComponent("電池")}` });
    await waitFor(() => expect(titles()).toHaveLength(3));
    const excerpt = screen.getByTestId(`excerpt-${ids.feed}`);
    expect(textOf(excerpt)).toMatch(/^…/);
    expect(textOf(excerpt)).toContain("新しい電池の工場");
    expect(matchesIn(excerpt)).toEqual(["電池"]);
    expect(matchesIn(screen.getByTestId(`title-${ids.aOld}`))).toEqual(["電池"]);
  });

  it("mark a match in a headline of importance five apart from the importance mark", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "AI の大きな発表", importance: 5 });
    await renderApp({ server, url: "/search?q=ai" });
    const title = await screen.findByTestId(`title-${id}`);
    const [match] = within(title).getAllByTestId("search-match");
    expect(textOf(match!)).toBe("AI");
    const style = Object.assign({}, ...[match!.props.style].flat());
    expect(style.textDecorationLine).toBe("underline");
    expect(style.backgroundColor).not.toBe(Object.assign({}, ...[title.props.style].flat(5).filter(Boolean)).backgroundColor);
  });

  it("say that nothing matched and suggest fewer words", async () => {
    const { server } = await seeded();
    await renderApp({ server, url: `/search?q=${encodeURIComponent("存在しない語")}` });
    expect(await screen.findByText("「存在しない語」に一致する記事はありません。")).toBeOnTheScreen();
    expect(screen.getByText("語を減らすと、見つかることがあります。")).toBeOnTheScreen();
  });
});

describe("an article opened from the search results", () => {
  it("has its headline and every match in its body marked, and swiping follows the results", async () => {
    const server = await makeServer();
    const category = await server.category();
    const older = await server.article(category.id, { title: "電池の前の話", body: "前の記事の電池。" });
    await server.advance(MINUTE);
    await server.article(category.id, { title: "関係のない話", body: "別の話。" });
    await server.advance(MINUTE);
    await server.article(category.id, { title: "電池の話", body: "電池の工場。\n\n**電池**の値段と `電池` の型。" });
    await renderApp({ server, url: `/search?q=${encodeURIComponent("電池")}` });
    await waitFor(() => expect(titles()).toEqual(["電池の話", "電池の前の話"]));

    await press(/^電池の話/);
    const heading = await screen.findByRole("header", { name: "電池の話" });
    // The neighbour is drawn beside the page in view: the page is the one with this headline.
    const page = screen.getAllByLabelText("記事").find((candidate) => within(candidate).queryByRole("header", { name: "電池の話" }) !== null)!;
    expect(matchesIn(heading)).toEqual(["電池"]);
    expect(matchesIn(page)).toEqual(["電池", "電池", "電池", "電池"]);
    expect(screen.getByLabelText("2件のうち1件目")).toBeOnTheScreen();

    const pager = screen.getByTestId("article-pager");
    const nativeEvent = { contentOffset: { x: WIDTH, y: 0 }, contentSize: { width: WIDTH * 2, height: 1334 }, layoutMeasurement: { width: WIDTH, height: 1334 } };
    await fireEvent.scroll(pager, { nativeEvent });
    await fireEvent(pager, "momentumScrollEnd", { nativeEvent });

    const next = await screen.findByRole("header", { name: "電池の前の話" });
    expect(matchesIn(next)).toEqual(["電池"]);
    await eventually(async () => expect(await isRead(server, older)).toBe(true));
  });

  it("is not marked when opened from a list", async () => {
    const server = await makeServer();
    await server.article((await server.category()).id, { title: "電池の話", body: "電池の工場。" });
    await renderApp({ server, url: "/list/all" });
    await press(/^電池の話/);
    const page = await screen.findByLabelText("記事");
    await within(page).findByRole("header", { name: "電池の話" });
    expect(within(page).queryAllByTestId("search-match")).toHaveLength(0);
  });
});
