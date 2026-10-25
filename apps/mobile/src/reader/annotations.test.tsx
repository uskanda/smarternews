import { ANNOTATION_SAMPLE_MARKDOWN, ANNOTATION_SAMPLE_TEXT, withoutSpaces } from "@smarternews/client/testing";
import { screen, userEvent, within } from "@testing-library/react-native";
import { renderApp } from "../testing/app";
import { eventually } from "../testing/queries";
import { makeServer, type TestServer } from "../testing/server";
import { colors } from "../theme/tokens";
import { markdownText } from "./Markdown";

const AT = "2026-03-01T11:00:00.000Z";
const NOW = "2026-03-01T12:00:00.000Z";
const press = async (name: string | RegExp) => userEvent.setup().press(await screen.findByRole("button", { name }));
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(5).filter(Boolean)) as Record<string, unknown>;
const anchor = (quote: string, note: string | null = null) => ({ quote, prefix: "", suffix: "", position: 0, note });

/** The text a node draws, nested texts included. */
interface Drawn {
  children: ReadonlyArray<Drawn | string>;
}
function textOf(node: Drawn | string): string {
  return typeof node === "string" ? node : node.children.map(textOf).join("");
}
/** The highlights drawn on the screen, as their text. */
const highlights = () => screen.queryAllByTestId(/^annotation-\d+$/).map((mark) => textOf(mark as unknown as Drawn));

/** One feed article, alone in its feed so that the pager draws no neighbour. */
async function oneArticle(server: TestServer, body: string, options: { translate?: boolean } = {}) {
  const blog = await server.core<{ id: number }>("insertFeed", { url: "https://blog.example.org/feed.xml", title: "Blog", translate: options.translate }, "$clock");
  const id = await server.feedArticle(blog.id, { title: "Story", body, at: AT });
  return { id, url: `/list/feed-${blog.id}` };
}

describe("the text a body is drawn from", () => {
  it("is the text of the tokens, the same as the web app's apart from spaces", () => {
    expect(withoutSpaces(markdownText(ANNOTATION_SAMPLE_MARKDOWN))).toBe(ANNOTATION_SAMPLE_TEXT);
  });
});

describe("highlights on the article screen", () => {
  it("draws the highlights made on the web, marks the one with a note, and shows its note when pressed", async () => {
    const server = await makeServer();
    const { id, url } = await oneArticle(server, "最初の段落です。\n\n電池の工場を新設すると発表した。\n\n最後の段落です。");
    await server.core("addHighlight", id, anchor("電池の工場を新設する", "規模を確かめる"), NOW);
    await server.core("addHighlight", id, anchor("最後の段落"), NOW);
    await renderApp({ server, url });
    await press(/^Story/);

    await eventually(() => expect(highlights()).toEqual(["電池の工場を新設する", "最後の段落"]));
    const [first] = screen.getAllByTestId(/^annotation-\d+$/);
    expect(flat(first!.props.style)).toMatchObject({ backgroundColor: colors.light["annotation-fill"] });
    // A highlight has no line under it: that is the search match and the terms.
    expect(flat(first!.props.style).textDecorationLine).toBeUndefined();
    const marks = screen.getAllByRole("button", { name: "ハイライト、メモあり" });
    expect(marks).toHaveLength(1);

    await userEvent.setup().press(marks[0]!);
    expect(await screen.findByText("規模を確かめる")).toBeOnTheScreen();
    expect(screen.getAllByText("電池の工場を新設する").length).toBeGreaterThan(1);
  });

  it("shows a note as written, and offers nothing to make, change or remove an annotation", async () => {
    const server = await makeServer();
    const { id, url } = await oneArticle(server, "本文の文。");
    await server.core("addHighlight", id, anchor("本文の文。", "**強調** と <b>タグ</b>"), NOW);
    await server.core("saveArticleNote", id, "**強調** と <b> のメモ", NOW);
    await renderApp({ server, url });
    await press(/^Story/);

    const note = await screen.findByTestId("article-note");
    expect(within(note).getByText("**強調** と <b> のメモ")).toBeOnTheScreen();
    await press("ハイライト、メモあり");
    expect(await screen.findByText("**強調** と <b>タグ</b>")).toBeOnTheScreen();
    await press("閉じる");
    for (const name of [/メモを書/, /ハイライトを(付け|消す)/, /メモを書き直す/]) expect(screen.queryByRole("button", { name })).toBeNull();
    await userEvent.setup().longPress(screen.getByText("本文の文。"));
    expect(screen.queryByText(/ハイライトを付ける/)).toBeNull();
  });

  it("puts the note on the whole article above the body, and has no button to write one", async () => {
    const server = await makeServer();
    const { id, url } = await oneArticle(server, "本文。");
    const plain = await server.feedArticle((await server.core<{ id: number }>("insertFeed", { url: "https://other.example.org/feed.xml", title: "Other" }, "$clock")).id, { title: "Plain", body: "本文。", at: AT });
    await server.core("saveArticleNote", id, "あとで比べる", NOW);
    await renderApp({ server, url });
    await press(/^Story/);
    expect(within(await screen.findByTestId("article-note")).getByText("あとで比べる")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: /メモ/ })).toBeNull();
    void plain;
  });

  it("lists the highlights the body no longer holds after it, with their notes", async () => {
    const server = await makeServer();
    const { id, url } = await oneArticle(server, "書き換えた本文。");
    await server.core("addHighlight", id, anchor("書き換えで消えた文。", "そのメモ"), NOW);
    await renderApp({ server, url });
    await press(/^Story/);

    const section = await screen.findByTestId("missing-highlights");
    expect(within(section).getByText("元の本文にあった箇所")).toBeOnTheScreen();
    expect(within(section).getByText("書き換えで消えた文。")).toBeOnTheScreen();
    expect(within(section).getByText("そのメモ")).toBeOnTheScreen();
    expect(highlights()).toEqual([]);
  });

  it("draws no highlight while what the feed delivered is shown in place of the full content", async () => {
    const server = await makeServer();
    const { id, url } = await oneArticle(server, "配信された短い文。");
    await server.core("saveFullContent", id, { markdown: "全文の最初。\n\n配信された短い文。", text: "全文", now: AT });
    await server.core("addHighlight", id, anchor("配信された短い文。"), NOW);
    await renderApp({ server, url });
    await press(/^Story/);
    await eventually(() => expect(highlights()).toEqual(["配信された短い文。"]));

    await press("全文の表示を切り替える");
    await eventually(() => expect(highlights()).toEqual([]));
    expect(screen.queryByTestId("missing-highlights")).toBeNull();
    await press("全文の表示を切り替える");
    await eventually(() => expect(highlights()).toEqual(["配信された短い文。"]));
  });

  it("marks the original of a translated body, and never the translation", async () => {
    const server = await makeServer();
    const { id, url } = await oneArticle(server, "The plant opens.", { translate: true });
    await server.core("saveArticleTranslation", id, { segments: [{ original: "The plant opens.", translated: "工場が開く。" }], method: "google", truncated: false, now: AT });
    await server.core("saveTranslatedTitle", id, { original: "Story", title: "話", sourceLanguage: "en" });
    await server.core("addHighlight", id, anchor("plant opens"), NOW);
    await renderApp({ server, url });
    await press(/^話/);

    await eventually(() => expect(highlights()).toEqual(["plant opens"]));
    expect(screen.getByText("工場が開く。")).toBeOnTheScreen();
  });
});

describe("an excerpt from a note in the search results", () => {
  it("says メモ before it, and reads it out", async () => {
    const server = await makeServer();
    const { id } = await oneArticle(server, "本文。");
    await server.core("saveArticleNote", id, "来月もう一度読む", NOW);
    await renderApp({ server, url: `/search?q=${encodeURIComponent("来月")}` });

    const excerpt = await screen.findByTestId(`excerpt-${id}`);
    expect(within(excerpt).getByTestId(`excerpt-note-${id}`)).toBeOnTheScreen();
    expect(textOf(excerpt as unknown as Drawn)).toBe("メモ 来月もう一度読む");
    expect(screen.getByRole("button", { name: /^Story。メモ、来月もう一度読む/ })).toBeOnTheScreen();
  });
});
