import { fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import * as WebBrowser from "expo-web-browser";
import { renderApp } from "../testing/app";
import { eventually, rowTitles } from "../testing/queries";
import { makeServer, type TestServer } from "../testing/server";

const WIDTH = 750; // the window of the test device
const at = (minutes: number) => new Date(Date.parse("2026-03-01T10:00:00.000Z") + minutes * 60_000).toISOString();
const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const openDrawer = () => press("項目を開く");
const isRead = async (server: TestServer, id: number) => (await server.core<{ isRead: boolean }>("getArticle", id)).isRead;
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(5).filter(Boolean)) as Record<string, unknown>;

/**
 * Tools holds one generated article and two feeds; Cars holds only a generated article; one feed has no
 * category. Times run from "Old post" to "Generated", the newest.
 */
async function seeded() {
  const server = await makeServer();
  const tools = await server.category("Tools");
  const cars = await server.category("Cars");
  const blog = await server.feed("Blog", tools.id);
  const releases = await server.feed("Releases", tools.id);
  const loose = await server.feed("Loose");
  const oldPost = await server.feedArticle(blog.id, { title: "Old post", at: at(0), body: "Old words." });
  const newPost = await server.feedArticle(blog.id, { title: "New post", at: at(60), body: "New words.", author: "Kim Author", url: "https://blog.example.org/new" });
  await server.feedArticle(releases.id, { title: "Release 2", at: at(30) });
  await server.feedArticle(loose.id, { title: "Stray", at: at(10) });
  const generated = await server.article(tools.id, { title: "Generated", importance: 5 });
  await server.article(cars.id, { title: "Car news" });
  return { server, tools, cars, blog, releases, loose, oldPost, newPost, generated };
}

describe("the drawer with subscribed feeds", () => {
  it("lists the generated articles and the feeds below a category that has feeds, with unread counts", async () => {
    const { server } = await seeded();
    await renderApp({ server });
    await openDrawer();

    expect(await screen.findByRole("button", { name: "Blog、未読2件" })).toBeOnTheScreen();
    const names = screen
      .getAllByRole("button")
      .map((node) => String(node.props.accessibilityLabel))
      .filter((name) => !/項目を|の下の項目/.test(name));
    const from = names.indexOf("未読、未読6件");
    expect(names.slice(from)).toEqual([
      "未読、未読6件",
      "すべて",
      "スター",
      "AI生成、未読2件",
      "最近読んだ記事",
      "Tools、未読4件",
      "ToolsのAI生成、未読1件",
      "Blog、未読2件",
      "Releases、未読1件",
      "Cars、未読1件",
      "未分類、未読1件",
      "Loose、未読1件",
      "設定",
    ]);
  });

  it("puts nothing below a category without feeds, and has no 未分類 without loose feeds", async () => {
    const server = await makeServer();
    await server.article((await server.category("Tools")).id);
    await renderApp({ server });
    await openDrawer();

    expect(await screen.findByRole("button", { name: "Tools、未読1件" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "AI生成、未読1件" })).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /未分類/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /の下の項目/ })).toBeNull();
  });

  it("folds the entries below a category with a control a finger can hit, and remembers it", async () => {
    const { server } = await seeded();
    const first = await renderApp({ server });
    await openDrawer();
    const fold = await screen.findByRole("button", { name: "Toolsの下の項目" });
    expect(fold.props.accessibilityState).toMatchObject({ expanded: true });
    expect(Number(flat(fold.props.style).minHeight)).toBeGreaterThanOrEqual(48);
    expect(Number(flat(fold.props.style).width)).toBeGreaterThanOrEqual(48);

    await userEvent.setup().press(fold);

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Blog/ })).toBeNull());
    expect(screen.getByRole("button", { name: "Tools、未読4件" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Toolsの下の項目" }).props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.getByRole("button", { name: "Loose、未読1件" })).toBeOnTheScreen();

    await first.unmount();
    await renderApp({ server });
    await openDrawer();
    await screen.findByRole("button", { name: "Tools、未読4件" });
    expect(screen.queryByRole("button", { name: /^Blog/ })).toBeNull();
  });
});

describe("the list an entry of the drawer opens", () => {
  it("mixes the generated articles and the feed articles of a category, newest first", async () => {
    const { server } = await seeded();
    await renderApp({ server });
    await openDrawer();
    await press("Tools、未読4件");
    await waitFor(() => expect(rowTitles()).toEqual(["Generated", "New post", "Release 2", "Old post"]));
  });

  it("shows only the unread articles of the feed that is chosen, under the feed's name", async () => {
    const { server, oldPost } = await seeded();
    await server.core("setArticleFlags", oldPost, { isRead: true }, "$now");
    await renderApp({ server });
    await openDrawer();
    await press("Blog、未読1件");

    await screen.findByRole("header", { name: "Blog" });
    await waitFor(() => expect(rowTitles()).toEqual(["New post"]));

    await userEvent.setup().press(screen.getByRole("switch", { name: "既読も表示" }));
    await waitFor(() => expect(rowTitles()).toEqual(["New post", "Old post"]));
    // Feed articles have no importance to filter by.
    expect(screen.queryByRole("switch", { name: "重要度4以上だけ" })).toBeNull();
  });

  it("shows only generated articles under the top AI生成", async () => {
    const { server } = await seeded();
    await renderApp({ server });
    await openDrawer();
    await press("AI生成、未読2件");
    await screen.findByRole("header", { name: "AI生成" });
    await waitFor(() => expect(rowTitles()).toEqual(["Car news", "Generated"]));
  });

  it("shows only the generated articles of a category under its AI生成", async () => {
    const { server } = await seeded();
    await renderApp({ server });
    await openDrawer();
    await press("ToolsのAI生成、未読1件");
    await screen.findByRole("header", { name: "ToolsのAI生成" });
    await waitFor(() => expect(rowTitles()).toEqual(["Generated"]));
  });

  it("shows the articles of feeds without a category under 未分類", async () => {
    const { server } = await seeded();
    await renderApp({ server });
    await openDrawer();
    await press("未分類、未読1件");
    await screen.findByRole("header", { name: "未分類" });
    await waitFor(() => expect(rowTitles()).toEqual(["Stray"]));
  });

  it("says so when the feed does not exist", async () => {
    const { server } = await seeded();
    await renderApp({ server, url: "/list/feed-999" });
    expect(await screen.findByText("この購読フィードはありません。")).toBeOnTheScreen();
  });

  it("marks only the feed that is open as read, and can undo it", async () => {
    const { server, blog, generated } = await seeded();
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await screen.findByText("New post");

    await press("すべて既読にする");

    expect(await screen.findByText("2件を既読にしました")).toBeOnTheScreen();
    expect(await isRead(server, generated)).toBe(false);
    await eventually(async () => expect((await server.core<{ feeds: Array<{ feedId: number; unread: number }> }>("getCounts", at(200))).feeds[0]).toEqual({ feedId: blog.id, unread: 0 }));
  });
});

describe("a feed article in the list", () => {
  it("shows and says the headline, the start of the content, the feed and the time, and no importance or source count", async () => {
    const { server, tools } = await seeded();
    await renderApp({ server, url: `/list/category-${tools.id}` });

    const row = await screen.findByRole("button", { name: /^New post/ });
    expect(row.props.accessibilityLabel).toBe("New post。New words。Blog。11:00。未読");
    expect(screen.queryByTestId(/^mark-/)).not.toBeNull(); // the generated article beside it has its mark
    const generated = screen.getByRole("button", { name: /Generated/ });
    expect(generated.props.accessibilityLabel).toMatch(/^重要度5。Generated。.*Tools。.*出典1件/);
  });

  it("offers its page, not a source, when it is pressed long", async () => {
    const { server, blog } = await seeded();
    (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
    await renderApp({ server, url: `/list/feed-${blog.id}` });

    await userEvent.setup().longPress(await screen.findByRole("button", { name: /^New post/ }));
    await press("元のページを開く");

    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://blog.example.org/new");
  });
});

describe("a feed article that is opened", () => {
  it("shows the headline, the feed, the author, when it was published, the content, and the way to its page first", async () => {
    const { server, blog } = await seeded();
    (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^New post/);

    expect(await screen.findByRole("header", { name: "New post" })).toBeOnTheScreen();
    expect(screen.getByLabelText("Blog、Kim Author、2026年3月1日 11:00 に公開")).toBeOnTheScreen();
    expect(screen.getByText("New words.")).toBeOnTheScreen();
    expect(screen.queryByText(/重要度/)).toBeNull();
    expect(screen.queryByText("出典")).toBeNull();

    // The neighbouring article is drawn too, off the screen; the first link belongs to the one in view.
    await userEvent.setup().press(screen.getAllByRole("link", { name: "元のページを開く" })[0]!);
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://blog.example.org/new");
  });

  it("is marked as read", async () => {
    const { server, blog, newPost } = await seeded();
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^New post/);
    await eventually(async () => expect(await isRead(server, newPost)).toBe(true));
  });

  it("is reached by swiping from the generated article before it in a mixed list, and is then read", async () => {
    const { server, tools, newPost } = await seeded();
    await renderApp({ server, url: `/list/category-${tools.id}` });
    await press(/Generated/);
    await screen.findByRole("header", { name: "Generated" });

    const pager = screen.getByTestId("article-pager");
    const nativeEvent = { contentOffset: { x: WIDTH, y: 0 }, contentSize: { width: WIDTH * 4, height: 1334 }, layoutMeasurement: { width: WIDTH, height: 1334 } };
    await fireEvent.scroll(pager, { nativeEvent });
    await fireEvent(pager, "momentumScrollEnd", { nativeEvent });

    expect(await screen.findByRole("header", { name: "New post" })).toBeOnTheScreen();
    await eventually(async () => expect(await isRead(server, newPost)).toBe(true));
  });

  it("takes a star like any article", async () => {
    const { server, blog, newPost } = await seeded();
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^New post/);
    await screen.findByRole("header", { name: "New post" });
    await press("スターを付ける");
    await eventually(async () => expect((await server.core<{ starred: boolean }>("getArticle", newPost)).starred).toBe(true));
  });
});

describe("images", () => {
  async function withImage(body: string, origin: "feed" | "generated" = "feed") {
    const server = await makeServer();
    const tools = await server.category("Tools");
    if (origin === "feed") await server.feedArticle((await server.feed("Blog", tools.id)).id, { title: "Pictures", body });
    else await server.article(tools.id, { title: "Pictures", body });
    await renderApp({ server });
    await press(/Pictures/);
    await screen.findByRole("header", { name: "Pictures" });
    return server;
  }

  /** The original address an image loads through the test server's relay, or null when it does not load from there. */
  function relayedFrom(server: TestServer, uri: string): string | null {
    const prefix = `${server.url}/api/v1/image-proxy/`;
    if (!uri.startsWith(prefix)) return null;
    const [, encoded] = uri.slice(prefix.length).split("/");
    return Buffer.from(encoded!, "base64url").toString("utf8");
  }

  it("are shown in the content of a feed article from the server's relay, as wide as the text and no wider", async () => {
    const server = await withImage("Before.\n\n![A chart](https://img.example.org/a.png)\n\nAfter.");
    const image = await screen.findByRole("image", { name: "A chart" });
    expect(relayedFrom(server, image.props.source.uri)).toBe("https://img.example.org/a.png");
    expect(flat(image.props.style)).toMatchObject({ width: "100%" });
    expect(screen.getByText("Before.")).toBeOnTheScreen();
    expect(screen.getByText("After.")).toBeOnTheScreen();
  });

  it("keep their proportions once their size is known", async () => {
    await withImage("![Wide](https://img.example.org/wide.png)");
    const image = await screen.findByRole("image", { name: "Wide" });
    await fireEvent(image, "load", { nativeEvent: { source: { width: 1600, height: 400 } } });
    expect(flat(screen.getByRole("image", { name: "Wide" }).props.style)).toMatchObject({ aspectRatio: 4 });
  });

  it("give way to their description when they cannot be loaded", async () => {
    await withImage("Before.\n\n![A chart](https://img.example.org/a.png)");
    await fireEvent(await screen.findByRole("image", { name: "A chart" }), "error", { nativeEvent: { error: "404" } });
    expect(screen.queryByRole("image")).toBeNull();
    expect(screen.getByText(/画像を表示できませんでした/)).toBeOnTheScreen();
    expect(screen.getByText("A chart")).toBeOnTheScreen();
    expect(screen.getByText("Before.")).toBeOnTheScreen();
  });

  it("without a description leave a word in their place when they cannot be loaded", async () => {
    await withImage("Before.\n\n![](https://img.example.org/a.png)");
    await fireEvent(await screen.findByRole("image"), "error", { nativeEvent: { error: "403" } });
    expect(screen.queryByRole("image")).toBeNull();
    expect(screen.getByText("画像を表示できませんでした")).toBeOnTheScreen();
  });

  it("over plain HTTP are loaded from the relay too, never from the other site", async () => {
    const server = await withImage("Text.\n\n![Plain](http://img.example.org/b.png)");
    const image = await screen.findByRole("image", { name: "Plain" });
    expect(relayedFrom(server, image.props.source.uri)).toBe("http://img.example.org/b.png");
  });

  it("are not loaded when their address is not on the relay", async () => {
    // The API rewrites what the content holds; an address it did not, as a model may write in a translation, stays a description.
    const server = await makeServer();
    const blog = await server.feed("Blog", (await server.category("Tools")).id);
    await server.core("updateFeed", blog.id, { translate: true }, "$clock");
    const id = await server.feedArticle(blog.id, { title: "Pictures", body: "Text." });
    await server.core("saveTranslatedTitle", id, { original: "Pictures", title: "Pictures", sourceLanguage: "en" });
    await server.core("saveArticleTranslation", id, {
      segments: [{ original: "Text.", translated: '訳 ![Direct](<https://img.example.org/c.png> "t") ![Inline](data:image/png;base64,AAAA)' }],
      method: "google",
      truncated: false,
      now: "2026-03-01T11:00:00.000Z",
    });
    await renderApp({ server });
    await press(/Pictures/);
    expect(await screen.findByText(/Direct/)).toBeOnTheScreen();
    expect(screen.queryByRole("image")).toBeNull();
  });

  it("are never loaded in a generated article: only the description is shown", async () => {
    await withImage("Text.\n\n![Described](https://img.example.org/a.png)", "generated");
    expect(screen.queryByRole("image")).toBeNull();
    expect(screen.getByText("Described")).toBeOnTheScreen();
  });
});
