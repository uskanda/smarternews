import { screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderApp } from "../testing/app";
import { eventually } from "../testing/queries";
import { makeServer } from "../testing/server";

const AT = "2026-03-01T11:00:00.000Z";
const AFTER = "2026-03-01T12:01:00.000Z";
const PAGE_URL = "https://blog.example.org/story";
const EXCERPT = "Only an excerpt.";
const FULL = "The whole story, from the page.\n\n![Wide](https://img.example.org/wide.png)\n\n![Plain](http://img.example.org/plain.png)\n\nThe end.";
const SHOWING_FULL = "元のページから取得した全文を表示しています。";
const FETCHING = "全文を取得しています。";
const TOGGLE = "全文の表示を切り替える";
const LONG = "A sentence of the page that the full content is taken from. ".repeat(8);
const PAGE = `<html><head><title>a</title></head><body><article><h1>a</h1><p>${LONG}</p><p>${LONG}</p></article></body></html>`;

const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(5).filter(Boolean)) as Record<string, unknown>;

/** One feed article, alone in its feed so that the pager draws no neighbour. */
async function oneArticle(options: { translate?: boolean; fetchFullContent?: boolean; storedAt?: string } = {}) {
  const server = await makeServer();
  const blog = await server.core<{ id: number }>(
    "insertFeed",
    { url: "https://blog.example.org/feed.xml", title: "Blog", translate: options.translate, fetchFullContent: options.fetchFullContent },
    "$clock",
  );
  const id = await server.feedArticle(blog.id, { title: "Story", body: EXCERPT, at: AT, url: PAGE_URL, ...(options.storedAt ? { storedAt: options.storedAt } : {}) });
  return { server, blog, id, url: `/list/feed-${blog.id}` };
}

describe("a feed article with full content", () => {
  it("shows the full content in the place of the content, says where it comes from, and keeps images to the width of the screen", async () => {
    const { server, id, url } = await oneArticle();
    await server.core("saveFullContent", id, { markdown: FULL, text: FULL, now: AT });
    await renderApp({ server, url });
    await press(/^Story/);

    expect(await screen.findByText("The whole story, from the page.")).toBeOnTheScreen();
    expect(screen.getByText(SHOWING_FULL)).toBeOnTheScreen();
    expect(screen.queryByText(EXCERPT)).toBeNull();
    const image = screen.getByRole("image", { name: "Wide" });
    expect(flat(image.props.style)).toMatchObject({ width: "100%" });
    expect(image.props.source.uri).toMatch(new RegExp(`^${server.url}/api/v1/image-proxy/`));
    // An image over plain HTTP is loaded through the relay like any other.
    expect(screen.getByRole("image", { name: "Plain" }).props.source.uri).toMatch(new RegExp(`^${server.url}/api/v1/image-proxy/`));
  });

  it("switches with the button on top to what the feed delivered and back, and says which is shown", async () => {
    const { server, id, url } = await oneArticle();
    await server.core("saveFullContent", id, { markdown: FULL, text: FULL, now: AT });
    await renderApp({ server, url });
    await press(/^Story/);
    await screen.findByText("The whole story, from the page.");

    const button = screen.getByRole("button", { name: TOGGLE });
    expect(button).toHaveAccessibilityValue({ text: "全文を表示中" });
    await userEvent.setup().press(button);
    expect(screen.getByText(EXCERPT)).toBeOnTheScreen();
    expect(screen.queryByText("The whole story, from the page.")).toBeNull();
    expect(screen.getByRole("button", { name: TOGGLE })).toHaveAccessibilityValue({ text: "配信された内容を表示中" });

    await press(TOGGLE);
    expect(screen.getByText("The whole story, from the page.")).toBeOnTheScreen();
  });

  it("shows the full content again when the article is opened again", async () => {
    const { server, id, url } = await oneArticle();
    await server.core("saveFullContent", id, { markdown: FULL, text: FULL, now: AT });
    await renderApp({ server, url });
    await press(/^Story/);
    await screen.findByText("The whole story, from the page.");
    await press(TOGGLE);
    expect(screen.getByText(EXCERPT)).toBeOnTheScreen();

    await press("一覧へ戻る");
    await press(/^Story/);
    expect(await screen.findByText("The whole story, from the page.")).toBeOnTheScreen();
  });
});

describe("the full content button", () => {
  it("is not shown for a generated article", async () => {
    const server = await makeServer();
    const category = await server.category("Security");
    await server.article(category.id, { title: "Generated", body: "Generated words." });
    await renderApp({ server });
    await press(/^Generated/);
    await screen.findByText("Generated words.");
    expect(screen.queryByRole("button", { name: "全文を取得" })).toBeNull();
    expect(screen.queryByRole("button", { name: TOGGLE })).toBeNull();
  });

  it("fetches the full content, shows the delivered content and that it is under way meanwhile, and cannot be pressed twice", async () => {
    const { server, id, url } = await oneArticle();
    await server.page(PAGE_URL, PAGE, { gated: true });
    const { requests } = await renderApp({ server, url });
    await press(/^Story/);
    await screen.findByText(EXCERPT);

    await press("全文を取得");
    expect(await screen.findByText(FETCHING)).toBeOnTheScreen();
    expect(screen.getByText(EXCERPT)).toBeOnTheScreen();
    await userEvent.setup().press(screen.getByRole("button", { name: "全文を取得" }));
    const posts = () => requests.filter((request) => request === `POST /api/v1/articles/${id}/full-content`);
    expect(posts()).toHaveLength(1);

    await server.releasePage(PAGE_URL);

    expect((await screen.findAllByText(/A sentence of the page/)).length).toBeGreaterThan(0);
    expect(screen.getByText(SHOWING_FULL)).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText(FETCHING)).toBeNull());
    expect(posts()).toHaveLength(1);
  });

  it("says why an earlier fetch failed, shows the delivered content, and stays to try again", async () => {
    const { server, id, url } = await oneArticle();
    await server.core("recordFullContentFailure", id, { reason: "http", detail: "404" });
    await renderApp({ server, url });
    await press(/^Story/);

    expect(await screen.findByText("全文を取得できませんでした。ページが見つかりませんでした（HTTP 404）。")).toBeOnTheScreen();
    expect(screen.getByText(EXCERPT)).toBeOnTheScreen();

    await server.page(PAGE_URL, PAGE);
    await press("全文を取得");
    expect((await screen.findAllByText(/A sentence of the page/)).length).toBeGreaterThan(0);
  });

  it("asks for the full content of an article that waits for it when it is opened", async () => {
    const { server, id, url } = await oneArticle({ fetchFullContent: true, storedAt: AFTER });
    await server.page(PAGE_URL, PAGE, { gated: true });
    const { requests } = await renderApp({ server, url });
    await press(/^Story/);

    expect(await screen.findByText(FETCHING)).toBeOnTheScreen();
    expect(requests.filter((request) => request === `POST /api/v1/articles/${id}/full-content`)).toHaveLength(1);
    await server.releasePage(PAGE_URL);
    expect((await screen.findAllByText(/A sentence of the page/)).length).toBeGreaterThan(0);
  });
});

describe("full content and translation", () => {
  it("asks again for the translation once the full content arrives, and shows the delivered content without one", async () => {
    const { server, id, url } = await oneArticle({ translate: true });
    await server.core("saveTranslatedTitle", id, { original: "Story", title: "訳:Story", sourceLanguage: "en" });
    await server.core("saveArticleTranslation", id, { segments: [{ original: EXCERPT, translated: "訳:抜粋。" }], method: "google", truncated: false, now: AT });
    await server.page(PAGE_URL, PAGE);
    const { requests } = await renderApp({ server, url });
    await press(/^訳:Story/);
    await screen.findByText("訳:抜粋。");

    await press("全文を取得");

    expect((await screen.findAllByText(/^訳:A sentence of the page/)).length).toBeGreaterThan(0);
    await eventually(async () => expect(requests.filter((request) => request === `POST /api/v1/articles/${id}/translation`)).toHaveLength(1));
    expect(screen.queryByText("訳:抜粋。")).toBeNull();

    await press(TOGGLE);
    expect(screen.getByText(EXCERPT)).toBeOnTheScreen();
    expect(screen.queryByText(/^訳:A sentence/)).toBeNull();
  });
});
