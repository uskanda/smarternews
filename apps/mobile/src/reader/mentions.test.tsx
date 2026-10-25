import { act, screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { router } from "expo-router";
import { chooseScrollRead } from "../settings/scroll-read";
import { renderApp } from "../testing/app";
import { eventually, MINUTE, rowTitles } from "../testing/queries";
import { makeServer, type TestServer } from "../testing/server";

const BOJ = { name: "日本銀行", kind: "organization" };
const MOF = { name: "財務省", kind: "organization" };
const TOKYO = { name: "東京", kind: "place" };

const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const isRead = async (server: TestServer, id: number) => (await server.core<{ isRead: boolean }>("getArticle", id)).isRead;
/** The device's back, as the stack takes it. */
const goBack = () => act(() => router.back());

/** Article X with names, a feed article and an older generated article that share a name, and one without names. */
async function seeded() {
  const server = await makeServer();
  const category = await server.category("Alpha");
  const ids: Record<string, number> = {};
  ids.old = await server.article(category.id, { title: "古い金融の話" });
  await server.core("replaceMentions", ids.old, [BOJ]);
  await server.advance(MINUTE);
  const feed = await server.feed("Money Feed");
  ids.feed = await server.feedArticle(feed.id, { title: "Feed on the bank", at: server.now().toISOString(), isRead: true });
  await server.core("replaceMentions", ids.feed, [BOJ, TOKYO]);
  await server.advance(MINUTE);
  ids.x = await server.article(category.id, { title: "利上げの記事", body: "日銀が利上げを決めた。" });
  await server.core("replaceMentions", ids.x, [BOJ, TOKYO, MOF]);
  ids.plain = await server.article(category.id, { title: "名前のない記事" });
  return { server, ids };
}

describe("the names below the body", () => {
  it("are grouped by kind, organizations before places, each kind in stored order", async () => {
    const { server, ids } = await seeded();
    await renderApp({ server, url: `/article/${ids.x}?list=all` });
    await screen.findByRole("header", { name: "利上げの記事" });

    const section = await screen.findByTestId("mentions");
    expect(within(section).getAllByRole("header").map((node) => node.props.children)).toEqual(["組織", "地名"]);
    expect(within(section).getAllByRole("link").map((node) => node.props.accessibilityLabel)).toEqual(["組織、日本銀行", "組織、財務省", "地名、東京"]);
  });

  it("are not there for an article without names", async () => {
    const { server, ids } = await seeded();
    await renderApp({ server, url: `/article/${ids.plain}?list=all` });
    await screen.findByRole("header", { name: "名前のない記事" });
    expect(screen.queryByTestId("mentions")).toBeNull();
    expect(screen.queryByRole("header", { name: "組織" })).toBeNull();
  });

  it("say the kind with the name, as a link, to a screen reader", async () => {
    const { server, ids } = await seeded();
    await renderApp({ server, url: `/article/${ids.x}?list=all` });
    const link = await screen.findByRole("link", { name: "組織、日本銀行" });
    expect(link.props.accessibilityRole).toBe("link");
  });

  it("show a name with tags as text, without bold", async () => {
    const server = await makeServer();
    const id = await server.article((await server.category()).id, { title: "話" });
    await server.core("replaceMentions", id, [{ name: "<b>太字</b>**強調**", kind: "product" }]);
    await renderApp({ server, url: `/article/${id}?list=all` });

    const link = await screen.findByRole("link", { name: "製品、<b>太字</b>**強調**" });
    const text = within(link).getByText("<b>太字</b>**強調**");
    expect(JSON.stringify(text.props.style)).not.toMatch(/fontWeight":"(bold|[6-9]00)/);
  });
});

describe("the list of a name", () => {
  it("opens over the article when a name is pressed, and back returns to that article", async () => {
    const { server, ids } = await seeded();
    const view = await renderApp({ server, url: `/article/${ids.x}?list=all` });
    await screen.findByRole("header", { name: "利上げの記事" });

    // The pager is laid out again once the list arrives, and a press on a link drawn before that is lost: wait for
    // the place in the list, which is shown from then on. The neighbouring pages are drawn too, and the feed
    // article beside X has the same name, so press it in X's names, the only ones with 財務省.
    await screen.findByLabelText(/^\d+件のうち\d+件目$/);
    const names = screen.getAllByTestId("mentions").find((section) => within(section).queryByRole("link", { name: "組織、財務省" }))!;
    await userEvent.setup().press(within(names).getByRole("link", { name: "組織、日本銀行" }));

    expect(await screen.findByRole("header", { name: "「日本銀行」を含む記事" })).toBeOnTheScreen();
    expect(view.pathname()).toMatch(/^\/mention\?name=/);
    // Generated and feed articles alike, read ones too, newest first.
    await eventually(() => expect(rowTitles()).toEqual(["利上げの記事", "Feed on the bank", "古い金融の話"]));

    await goBack();
    expect(await screen.findByRole("header", { name: "利上げの記事" })).toBeOnTheScreen();
    expect(view.pathname()).toMatch(new RegExp(`^/article/${ids.x}`));
  });

  it("opens an article of the list, and back from it returns to the same list", async () => {
    const { server, ids } = await seeded();
    const view = await renderApp({ server, url: `/mention?name=${encodeURIComponent("日本銀行")}` });
    await eventually(() => expect(rowTitles()).toHaveLength(3));

    await press(/Feed on the bank/);
    expect(await screen.findByRole("header", { name: "Feed on the bank" })).toBeOnTheScreen();
    expect(view.pathname()).toMatch(new RegExp(`^/article/${ids.feed}`));

    await goBack();
    expect(await screen.findByRole("header", { name: "「日本銀行」を含む記事" })).toBeOnTheScreen();
    await eventually(() => expect(rowTitles()).toEqual(["利上げの記事", "Feed on the bank", "古い金融の話"]));
  });

  it("offers neither marking all read, nor read ones, nor importance 4 and above, nor the order", async () => {
    const { server } = await seeded();
    await renderApp({ server, url: `/mention?name=${encodeURIComponent("日本銀行")}` });
    await eventually(() => expect(rowTitles()).toHaveLength(3));

    expect(screen.queryByRole("button", { name: "すべて既読にする" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "既読も表示" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "重要度4以上だけ" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^並び順/ })).toBeNull();
    expect(screen.queryByText("既読も表示")).toBeNull();
    expect(screen.getByRole("button", { name: "記事へ戻る" })).toBeOnTheScreen();
  });

  it("marks nothing read when scrolled, even with the setting to mark read what the list is scrolled past", async () => {
    await chooseScrollRead(true);
    const { server, ids } = await seeded();
    await renderApp({ server, url: `/mention?name=${encodeURIComponent("日本銀行")}` });
    await eventually(() => expect(rowTitles()).toHaveLength(3));
    const list = screen.getByTestId("article-list");
    const rows = list.props.data as Array<{ id: number }>;

    for (const first of [0, 3]) {
      const viewableItems = rows.slice(first).map((item, offset) => ({ item, key: String(item.id), index: first + offset, isViewable: true }));
      await act(async () => list.props.onViewableItemsChanged({ viewableItems, changed: [] }));
    }
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1200)));

    expect([await isRead(server, ids.x!), await isRead(server, ids.old!)]).toEqual([false, false]);
    expect(screen.queryByTestId("scroll-read-room")).toBeNull();
  });

  it("says that no article has the name once its only article is hidden by a filter and the list is pulled", async () => {
    const server = await makeServer();
    const feed = await server.feed("Sale Feed");
    const id = await server.feedArticle(feed.id, { title: "特売のお知らせ", at: server.now().toISOString() });
    await server.core("replaceMentions", id, [BOJ]);
    await renderApp({ server, url: `/mention?name=${encodeURIComponent("日本銀行")}` });
    await eventually(() => expect(rowTitles()).toEqual(["特売のお知らせ"]));

    await server.core("createFilter", { action: "hide", scope: { type: "all" }, conditions: [{ fields: ["title"], match: "contains", value: "特売" }] }, "$clock");
    const list = screen.getByTestId("article-list");
    await act(async () => list.props.refreshControl.props.onRefresh());

    expect(await screen.findByText("「日本銀行」を含む記事はありません。")).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryAllByTestId(/^title-\d+$/)).toHaveLength(0));
  });
});
