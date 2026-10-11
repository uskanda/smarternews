import { fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import { renderApp } from "../testing/app";
import { eventually } from "../testing/queries";
import { makeServer } from "../testing/server";

const WAITING = "翻訳しています。";
const FAILED = "翻訳できませんでした。原文を表示しています。";
const REST = "長い記事のため、ここから先は翻訳していません。";
const AT = "2026-03-01T11:00:00.000Z";
const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
/** Where a text stands among the texts of the screen, in the order they are drawn, to compare what comes first. */
const position = (text: string) =>
  screen
    .getAllByText(/./)
    .map((element) => [element.props.children].flat().join(""))
    .indexOf(text);

/** A feed that translates, with one article, so that the pager draws no neighbour beside it. */
async function oneArticle(options: Parameters<typeof makeServer>[1] = {}, translate = true) {
  const server = await makeServer(undefined, options);
  const blog = await server.feed("Blog");
  if (translate) await server.core("updateFeed", blog.id, { translate: true }, "$clock");
  const id = await server.feedArticle(blog.id, { title: "Original title", body: "First words.\n\nSecond words.", at: AT });
  return { server, blog, id };
}

async function stored(segments: Array<{ original: string; translated: string | null }>, truncated = false) {
  const s = await oneArticle();
  await s.server.core("saveTranslatedTitle", s.id, { original: "Original title", title: "訳したタイトル", sourceLanguage: "en" });
  await s.server.core("saveArticleTranslation", s.id, { segments, method: "google", truncated, now: AT });
  return s;
}

describe("the title of a translated feed article in the list", () => {
  it("is the translation for an article that has one, and the original for one that has none", async () => {
    const { server, blog, id } = await oneArticle();
    await server.feedArticle(blog.id, { title: "No translation yet", at: "2026-03-01T10:00:00.000Z" });
    await server.core("saveTranslatedTitle", id, { original: "Original title", title: "訳したタイトル", sourceLanguage: "en" });
    await renderApp({ server, url: `/list/feed-${blog.id}` });

    expect(await screen.findByRole("button", { name: /^訳したタイトル/ })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: /^No translation yet/ })).toBeOnTheScreen();
    expect(screen.queryByText("Original title")).toBeNull();
  });
});

describe("a translated feed article that is opened", () => {
  it("has the translated title as its headline with the original under it, and each translation with its original under it", async () => {
    const { server, blog } = await stored([
      { original: "First words.", translated: "最初の言葉。" },
      { original: "Second words.", translated: "次の言葉。" },
    ]);
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^訳したタイトル/);

    expect(await screen.findByRole("header", { name: "訳したタイトル" })).toBeOnTheScreen();
    expect(screen.getByTestId("original-title")).toHaveTextContent("Original title");
    const order = ["訳したタイトル", "Original title", "最初の言葉。", "First words.", "次の言葉。", "Second words."].map(position);
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(screen.queryByText(WAITING)).toBeNull();
  });

  it("shows the original smaller and quieter than the translation, and a segment without a translation as content", async () => {
    const { server, blog } = await stored([
      { original: "First words.", translated: "最初の言葉。" },
      { original: "Left as it is.", translated: null },
    ]);
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^訳したタイトル/);

    const size = (text: string) => [screen.getByText(text).props.style].flat(3).reduce((all: object, part: object) => ({ ...all, ...part }), {}) as { fontSize: number; color: string };
    await screen.findByText("最初の言葉。");
    expect(size("First words.").fontSize).toBeLessThan(size("最初の言葉。").fontSize);
    expect(size("First words.").color).not.toBe(size("最初の言葉。").color);
    expect(size("Left as it is.")).toEqual(size("最初の言葉。"));
  });

  it("shows a segment once when the translation is the same text, and says where the translation ends", async () => {
    const { server, blog } = await stored(
      [
        { original: "Same in both.", translated: "Same in both." },
        { original: "Translated part.", translated: "訳した部分。" },
        { original: "The rest.", translated: null },
      ],
      true,
    );
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^訳したタイトル/);

    await screen.findByText("訳した部分。");
    expect(screen.getAllByText("Same in both.")).toHaveLength(1);
    expect(position("Translated part.")).toBeLessThan(position(REST));
    expect(position(REST)).toBeLessThan(position("The rest."));
  });
});

describe("opening an article of a feed that translates", () => {
  it("shows the original and that it is being translated, then the translations when they arrive", async () => {
    const { server, blog } = await oneArticle({ translation: "gated" });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^Original title/);

    expect(await screen.findByText(WAITING)).toBeOnTheScreen();
    expect(screen.getByText("First words.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "Original title" })).toBeOnTheScreen();
    expect(position(WAITING)).toBeLessThan(position("First words."));

    await server.releaseTranslation();

    expect(await screen.findByText("訳:First words.")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: "訳:Original title" })).toBeOnTheScreen();
    expect(screen.getByTestId("original-title")).toHaveTextContent("Original title");
    const order = ["訳:First words.", "First words.", "訳:Second words.", "Second words."].map(position);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    await waitFor(() => expect(screen.queryByText(WAITING)).toBeNull());
  });

  it("keeps the original and offers to try again when the article cannot be translated now", async () => {
    const { server, blog, id } = await oneArticle({ translation: "none" });
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^Original title/);

    expect(await screen.findByText(FAILED)).toBeOnTheScreen();
    expect(screen.getByText("First words.")).toBeOnTheScreen();
    expect(screen.queryByTestId("original-title")).toBeNull();

    // Once something can translate again, trying again brings the translation.
    await server.core("saveTranslatedTitle", id, { original: "Original title", title: "訳したタイトル", sourceLanguage: null });
    await server.core("saveArticleTranslation", id, { segments: [{ original: "First words.", translated: "最初の言葉。" }], method: "llm", truncated: false, now: AT });
    await press("翻訳をやり直す");
    expect(await screen.findByText("最初の言葉。")).toBeOnTheScreen();
    expect(screen.queryByText(FAILED)).toBeNull();
  });

  it("asks for nothing and shows the content as before for an article of a feed that does not translate", async () => {
    const { server, blog } = await oneArticle({ translation: "gated" }, false);
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^Original title/);

    expect(await screen.findByText("First words.")).toBeOnTheScreen();
    expect(screen.queryByText(WAITING)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});

describe("the articles beside the one that is open", () => {
  const WIDTH = 750; // the window of the test device

  it("are translated when the user comes to them, not before", async () => {
    const server = await makeServer();
    const blog = await server.feed("Blog");
    await server.core("updateFeed", blog.id, { translate: true }, "$clock");
    const ids: number[] = [];
    for (const [title, at] of [["Newest", "11"], ["Middle", "10"], ["Oldest", "09"]] as const)
      ids.push(await server.feedArticle(blog.id, { title, body: `${title} words.`, at: `2026-03-01T${at}:00:00.000Z` }));
    const translated = async () => (await server.sql<Array<{ id: number }>>("SELECT article_id AS id FROM article_translations ORDER BY article_id")).map((row) => row.id);
    await renderApp({ server, url: `/list/feed-${blog.id}` });
    await press(/^Newest/);

    // The pager draws the next article beside the open one, and that one waits.
    expect(await screen.findByText("訳:Newest words.")).toBeOnTheScreen();
    expect(await screen.findByText("Middle words.")).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText(WAITING)).toBeNull());
    expect(await translated()).toEqual([ids[0]]);

    const pager = screen.getByTestId("article-pager");
    const nativeEvent = { contentOffset: { x: WIDTH, y: 0 }, contentSize: { width: WIDTH * 3, height: 1334 }, layoutMeasurement: { width: WIDTH, height: 1334 } };
    await fireEvent.scroll(pager, { nativeEvent });
    await fireEvent(pager, "momentumScrollEnd", { nativeEvent });

    expect(await screen.findByText("訳:Middle words.")).toBeOnTheScreen();
    await eventually(async () => expect(await translated()).toEqual([ids[0], ids[1]]));
  });
});
